import { jest } from '@jest/globals';
/* eslint-disable @typescript-eslint/no-explicit-any -- focused worker Prisma test doubles */
import { PlayerAuctionWorker } from './player-auction-worker.js';

describe('PlayerAuctionWorker', () => {
  it('emits only the latest crossed countdown mark for the current deadline epoch', async () => {
    const now = new Date('2026-10-09T12:00:26.000Z');
    const lot: any = { id: 'lot-1', status: 'ACTIVE', deadlineAt: new Date('2026-10-09T12:00:30.000Z'), deadlineEpoch: 2, lastCountdownMark: 10, batch: { groupBinding: { deviceId: 'device-1', wechatGroupId: 'room@chatroom' } } };
    const prisma: any = { playerAuctionLot: { findMany: jest.fn(async () => [lot]), updateMany: jest.fn(async () => ({ count: 1 })) }, wechatOutboxMessage: { count: jest.fn(async () => 0) } };
    const outbox: any = { enqueue: jest.fn(async () => undefined) };
    const worker = new PlayerAuctionWorker(prisma, { now: () => now } as never, {} as never, outbox, { scanUnavailableDevices: jest.fn() } as never);
    await worker.tick();
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ businessKey: 'auction:lot-1:epoch:2:countdown:4', text: '4' }));
  });

  it('closes only the matching due epoch and never starts the next lot', async () => {
    const now = new Date('2026-10-09T12:00:30.000Z');
    const lot: any = { id: 'lot-1', batchId: 'batch-1', status: 'ACTIVE', deadlineAt: now, deadlineEpoch: 3, currentHighestBidId: 'bid-1' };
    const tx: any = { playerAuctionLot: { findUnique: jest.fn(async () => lot), updateMany: jest.fn(async () => ({ count: 1 })) } };
    const prisma: any = { $transaction: jest.fn(async (work: any) => work(tx)) };
    const worker = new PlayerAuctionWorker(prisma, { now: () => now } as never, { lockLot: jest.fn(), now: jest.fn(async () => now) } as never, {} as never, { scanUnavailableDevices: jest.fn() } as never);
    await expect(worker.closeDueLot('lot-1', 2)).resolves.toBe(false);
    await expect(worker.closeDueLot('lot-1', 3)).resolves.toBe(true);
    expect(tx.playerAuctionLot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_REVIEW' }) }));
  });
});
