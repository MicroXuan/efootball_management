/* eslint-disable @typescript-eslint/no-explicit-any -- transactional persistence boundary */
import { jest } from '@jest/globals';
import { PlayerAuctionPauseTimeoutService } from './player-auction-pause-timeout.service.js';

function harness(status = 'PAUSED', pausedAt = new Date('2026-10-30T12:00:00.000Z')) {
  const now = new Date('2026-10-30T13:00:00.000Z');
  const batch: any = { id: 'batch-1', leagueId: 'league-1', groupBindingId: 'group-1', status, pausedAt, currentLotId: 'lot-1', version: 2 };
  const lots = ['PAUSED', 'QUEUED', 'PENDING_REVIEW', 'NO_BID', 'SOLD'].map((status, index) => ({
    id: `lot-${index + 1}`, status, deadlineAt: null, pausedRemainingMs: 500, deadlineEpoch: 1, version: 1
  }));
  const audit: any[] = [];
  const tx: any = {
    playerAuctionBatch: {
      findUnique: jest.fn(async () => batch),
      update: jest.fn(async ({ data }: any) => Object.assign(batch, data))
    },
    playerAuctionLot: { updateMany: jest.fn(async ({ where, data }: any) => {
      for (const lot of lots.filter((lot) => where.status.in.includes(lot.status))) {
        for (const [key, value] of Object.entries(data) as any) {
          (lot as any)[key] = value && typeof value === 'object' && 'increment' in value ? (lot as any)[key] + value.increment : value;
        }
      }
      return { count: 2 };
    }) },
    auditLog: { create: jest.fn(async ({ data }: any) => { audit.push(data); return data; }) }
  };
  const prisma: any = {
    playerAuctionBatch: { findMany: jest.fn(async ({ where }: any) =>
      where.status.in.includes(batch.status) && batch.pausedAt && batch.pausedAt <= where.pausedAt.lte ? [batch] : []) },
    $transaction: jest.fn(async (work: any) => work(tx))
  };
  const locks: any = { lockLeague: jest.fn(), lockGroup: jest.fn(), lockBatch: jest.fn(), now: async () => now };
  return { service: new PlayerAuctionPauseTimeoutService(prisma, locks), prisma, tx, batch, lots, audit, now, locks };
}

describe('PlayerAuctionPauseTimeoutService', () => {
  it.each(['PAUSED', 'RECOVERY_REQUIRED'])('cancels %s after one continuous hour, preserves ended lots, and is idempotent', async (status) => {
    const h = harness(status);
    await expect(h.service.cancelExpired(h.now)).resolves.toBe(1);
    expect(h.batch).toMatchObject({ status: 'CANCELLED', currentLotId: null, cancelledAt: h.now });
    expect(h.lots.map((lot) => lot.status)).toEqual(['VOID', 'VOID', 'PENDING_REVIEW', 'NO_BID', 'SOLD']);
    expect(h.lots[0]).toMatchObject({ deadlineEpoch: 2, pausedRemainingMs: null });
    await expect(h.service.cancelExpired(h.now)).resolves.toBe(0);
    expect(h.audit).toHaveLength(1);
  });

  it('keeps a pause shorter than one hour recoverable', async () => {
    const h = harness('PAUSED', new Date('2026-10-30T12:00:00.001Z'));
    await expect(h.service.cancelExpired(h.now)).resolves.toBe(0);
    expect(h.batch.status).toBe('PAUSED');
  });

  it('rechecks the locked state if a resume wins the race', async () => {
    const h = harness();
    h.locks.lockBatch.mockImplementation(async () => { h.batch.status = 'ACTIVE'; h.batch.pausedAt = null; });
    await expect(h.service.cancelExpired(h.now)).resolves.toBe(0);
    expect(h.lots[0]!.status).toBe('PAUSED');
    expect(h.audit).toHaveLength(0);
  });
});
