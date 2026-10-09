/* eslint-disable @typescript-eslint/no-explicit-any -- focused recovery transaction test doubles */
import { jest } from '@jest/globals';
import { PlayerAuctionRecoveryService } from './player-auction-recovery.service.js';

describe('PlayerAuctionRecoveryService', () => {
  it('enters recovery once per unavailable bridge and retains the frozen lot', async () => {
    const state: any = { enterRecovery: jest.fn(async () => ({ transition: 'RECOVERY_REQUIRED', batchId: 'batch-1' })) };
    const prisma: any = { playerAuctionBatch: { findMany: jest.fn(async () => [{ id: 'batch-1', groupBindingId: 'group-1' }]) } };
    const service = new PlayerAuctionRecoveryService(prisma, state, {} as never, {} as never, {} as never, { heartbeatTimeoutMs: 30_000 } as never);
    await service.onBridgeUnavailable('device-1', 'HEARTBEAT_TIMEOUT');
    await service.onBridgeUnavailable('device-1', 'HEARTBEAT_TIMEOUT');
    expect(state.enterRecovery).toHaveBeenCalledTimes(1);
  });

  it('authorized recovery performs an explicit full 30-second restart', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const batch: any = { id: 'batch-1', leagueId: 'league-1', groupBindingId: 'group-1', currentLotId: 'lot-1', status: 'RECOVERY_REQUIRED' };
    const lot: any = { id: 'lot-1', status: 'PAUSED' };
    const tx: any = { playerAuctionBatch: { findUnique: jest.fn(async () => batch), update: jest.fn(async ({ data }: any) => Object.assign(batch, data)) }, playerAuctionLot: { findUnique: jest.fn(async () => lot), update: jest.fn(async ({ data }: any) => Object.assign(lot, data)) } };
    const service = new PlayerAuctionRecoveryService(
      { $transaction: async (work: any) => work(tx) } as never,
      {} as never,
      { can: jest.fn(async () => true) } as never,
      { lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) } as never,
      { enqueue: jest.fn() } as never,
      { heartbeatTimeoutMs: 30_000 } as never
    );
    await service.recover('batch-1', 'user-1');
    expect(lot.deadlineAt.toISOString()).toBe('2026-10-09T12:00:30.000Z');
    expect(lot.deadlineEpoch).toEqual({ increment: 1 });
  });
});
