/* eslint-disable @typescript-eslint/no-explicit-any -- focused state-machine transaction test doubles */
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
      playerAuctionBatch: { findFirst: jest.fn(async () => batch), findUnique: jest.fn(async () => batch), update: jest.fn(async ({ data }: any) => Object.assign(batch, data)) },
      playerAuctionLot: { findFirst: jest.fn(async () => lot), findMany: jest.fn(async () => [lot]), findUnique: jest.fn(async () => lot), update: jest.fn(async ({ data }: any) => Object.assign(lot, data)) },
      leaguePlayerOwnership: { findFirst: jest.fn(async () => null) }
    };
    const prisma: any = { $transaction: jest.fn(async (work: any) => work(tx)) };
    const locks: any = { lockLeague: jest.fn(), lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) };
    const auth: any = { can: jest.fn(async () => true) };
    const service = new PlayerAuctionStateService(prisma, locks, auth);

    expect(service.activity.isAwake()).toBe(false);
    await service.start('group-1', 'user-1');
    expect(service.activity.isAwake()).toBe(true);
    expect(lot.deadlineAt.toISOString()).toBe('2026-10-09T12:00:30.000Z');
    now.setTime(Date.parse('2026-10-09T12:00:07.250Z'));
    await service.pause('group-1', 'user-1');
    expect(lot.pausedRemainingMs).toBe(22_750);
    now.setTime(Date.parse('2026-10-09T12:01:00.000Z'));
    await service.resume('group-1', 'user-1');
    expect(lot.deadlineAt.toISOString()).toBe('2026-10-09T12:01:22.750Z');
    expect(batch.pausedAt).toBeNull();
    now.setTime(Date.parse('2026-10-09T12:01:02.000Z'));
    await service.pause('group-1', 'user-1');
    expect(batch.pausedAt.toISOString()).toBe('2026-10-09T12:01:02.000Z');
  });

  it('refuses to start if a queued player joined a league team after preparation', async () => {
    const batch = { id: 'batch-1', leagueId: 'league-1', status: 'READY', version: 1 };
    const lot = { id: 'lot-1', footballPlayerId: 'player-1', status: 'QUEUED' };
    const tx: any = {
      playerAuctionBatch: { findUnique: jest.fn(async () => batch), update: jest.fn() },
      playerAuctionLot: { findFirst: jest.fn(async () => lot), findMany: jest.fn(async () => [lot]), update: jest.fn() },
      leaguePlayerOwnership: { findFirst: jest.fn(async () => ({ footballPlayerId: 'player-1' })) }
    };
    const service = new PlayerAuctionStateService({} as never, { lockBatch: jest.fn() } as never, {} as never);
    await expect(service.startBatch(tx, batch.id, 1)).rejects.toMatchObject({ code: 'AUCTION_PLAYER_ALREADY_OWNED' });
    expect(tx.playerAuctionLot.update).not.toHaveBeenCalled();
    expect(tx.playerAuctionBatch.update).not.toHaveBeenCalled();
  });

  it('does not expose manual next-lot progression', () => {
    const service = new PlayerAuctionStateService({} as never, {} as never, {} as never);
    expect((service as unknown as { next?: unknown }).next).toBeUndefined();
  });

  it('rejects a manager without the league auction permission', async () => {
    const tx = { wechatGroupBinding: { findUnique: jest.fn(async () => ({ id: 'group-1', leagueId: 'league-1', enabled: true })) } };
    const service = new PlayerAuctionStateService(
      { $transaction: async (work: any) => work(tx) } as never,
      { lockLeague: jest.fn(), lockGroup: jest.fn() } as never,
      { can: jest.fn(async () => false) } as never
    );
    await expect(service.start('group-1', 'user-1')).rejects.toMatchObject({ code: 'AUCTION_FORBIDDEN' });
  });
});

describe('auction continuous pause deadline', () => {
  it.each(['PAUSED', 'RECOVERY_REQUIRED'])('rejects resuming %s at the one-hour boundary', async (status) => {
    const now = new Date('2026-10-30T13:00:00.000Z');
    const batch: any = { id: 'batch-1', leagueId: 'league-1', status, bidChannel: 'WECHAT_GROUP',
      currentLotId: 'lot-1', version: 1, pausedAt: new Date('2026-10-30T12:00:00.000Z') };
    const lot: any = { id: 'lot-1', status: 'PAUSED', pausedRemainingMs: 500 };
    const tx: any = {
      playerAuctionBatch: { findUnique: jest.fn(async () => batch), update: jest.fn() },
      playerAuctionLot: { findUnique: jest.fn(async () => lot), findUniqueOrThrow: jest.fn(async () => lot), update: jest.fn() }
    };
    const state = new PlayerAuctionStateService({} as never,
      { lockBatch: jest.fn(), lockLot: jest.fn(), now: async () => now } as never, {} as never);
    const result = status === 'PAUSED' ? state.resumeBatch(tx, batch.id, 1) : state.recoverBatch(tx, batch.id, 1);
    await expect(result).rejects.toMatchObject({ code: 'AUCTION_PAUSE_EXPIRED' });
    expect(tx.playerAuctionLot.update).not.toHaveBeenCalled();
  });

  it('preserves the original pause time when a manually paused auction enters recovery', async () => {
    const pausedAt = new Date('2026-10-30T12:00:00.000Z');
    const now = new Date('2026-10-30T12:50:00.000Z');
    const batch: any = { id: 'batch-1', leagueId: 'league-1', status: 'PAUSED', currentLotId: 'lot-1', pausedAt };
    const lot = { id: 'lot-1', status: 'PAUSED', pausedRemainingMs: 500 };
    const tx: any = {
      playerAuctionBatch: { findFirst: jest.fn(async () => batch), update: jest.fn(async ({ data }: any) => Object.assign(batch, data)) },
      playerAuctionLot: { findUnique: jest.fn(async () => lot), update: jest.fn() }
    };
    const state = new PlayerAuctionStateService({ $transaction: async (work: any) => work(tx) } as never,
      { lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: async () => now } as never, {} as never);
    await state.enterRecovery('group-1', 'HEARTBEAT_TIMEOUT');
    expect(batch.pausedAt).toEqual(pausedAt);
    expect(batch.status).toBe('RECOVERY_REQUIRED');
  });
});
