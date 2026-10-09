import { jest } from '@jest/globals';
import { PlayerAuctionStateService } from './player-auction-state.service.js';

describe('PlayerAuctionStateService', () => {
  it('starts, pauses and resumes with a database-authoritative remaining duration', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const group = { id: 'group-1', leagueId: 'league-1', enabled: true };
    const batch: any = { id: 'batch-1', groupBindingId: group.id, leagueId: group.leagueId, status: 'READY', currentLotId: null };
    const lot: any = { id: 'lot-1', batchId: batch.id, status: 'QUEUED', displayOrder: 1 };
    const tx: any = {
      wechatGroupBinding: { findUnique: jest.fn(async () => group) },
      playerAuctionBatch: { findFirst: jest.fn(async () => batch), update: jest.fn(async ({ data }: any) => Object.assign(batch, data)) },
      playerAuctionLot: { findFirst: jest.fn(async () => lot), findUnique: jest.fn(async () => lot), update: jest.fn(async ({ data }: any) => Object.assign(lot, data)) }
    };
    const prisma: any = { $transaction: jest.fn(async (work: any) => work(tx)) };
    const locks: any = { lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) };
    const auth: any = { can: jest.fn(async () => true) };
    const service = new PlayerAuctionStateService(prisma, locks, auth);

    await service.start('group-1', 'user-1');
    expect(lot.deadlineAt.toISOString()).toBe('2026-10-09T12:00:30.000Z');
    now.setTime(Date.parse('2026-10-09T12:00:07.250Z'));
    await service.pause('group-1', 'user-1');
    expect(lot.pausedRemainingMs).toBe(22_750);
    now.setTime(Date.parse('2026-10-09T12:01:00.000Z'));
    await service.resume('group-1', 'user-1');
    expect(lot.deadlineAt.toISOString()).toBe('2026-10-09T12:01:22.750Z');
  });

  it('never auto-starts the next lot and completes only on an explicit next command', async () => {
    const group = { id: 'group-1', leagueId: 'league-1', enabled: true };
    const batch: any = { id: 'batch-1', groupBindingId: group.id, leagueId: group.leagueId, status: 'ACTIVE', currentLotId: 'lot-1' };
    const lot: any = { id: 'lot-1', batchId: batch.id, status: 'PENDING_REVIEW', displayOrder: 1 };
    const tx: any = {
      wechatGroupBinding: { findUnique: jest.fn(async () => group) },
      playerAuctionBatch: { findFirst: jest.fn(async () => batch), update: jest.fn(async ({ data }: any) => Object.assign(batch, data)) },
      playerAuctionLot: { findUnique: jest.fn(async () => lot), findFirst: jest.fn(async () => null), update: jest.fn() }
    };
    const service = new PlayerAuctionStateService(
      { $transaction: async (work: any) => work(tx) } as never,
      { lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => new Date()) } as never,
      { can: jest.fn(async () => true) } as never
    );

    await service.next('group-1', 'user-1');
    expect(batch.status).toBe('COMPLETED');
  });

  it('rejects a manager without the league auction permission', async () => {
    const tx = { wechatGroupBinding: { findUnique: jest.fn(async () => ({ id: 'group-1', leagueId: 'league-1', enabled: true })) } };
    const service = new PlayerAuctionStateService(
      { $transaction: async (work: any) => work(tx) } as never,
      { lockGroup: jest.fn() } as never,
      { can: jest.fn(async () => false) } as never
    );
    await expect(service.start('group-1', 'user-1')).rejects.toMatchObject({ code: 'AUCTION_FORBIDDEN' });
  });
});
