import { jest } from '@jest/globals';
/* eslint-disable @typescript-eslint/no-explicit-any -- focused worker Prisma test doubles */
import { PlayerAuctionWorker } from './player-auction-worker.js';
import { PlayerAuctionMessageFormatter } from './player-auction-message.formatter.js';

function applyData(target: any, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    target[key] = value && typeof value === 'object' && 'increment' in value
      ? (target[key] ?? 0) + value.increment
      : value;
  }
  return target;
}

function closingHarness({ highestBid = true, includeNext = true } = {}) {
  const now = new Date('2026-10-09T12:00:30.000Z');
  const current: any = {
    id: 'lot-1', batchId: 'batch-1', displayOrder: 1, playerNameSnapshot: '车范根',
    playerSnapshot: { card: { position: 'CF', overallRating: 96 } }, startingPrice: 50,
    minimumIncrement: 10, currentPrice: highestBid ? 120 : null, status: 'ACTIVE',
    deadlineAt: now, deadlineEpoch: 3, currentHighestBidId: highestBid ? 'bid-1' : null,
    currentHighestBid: highestBid ? { leagueTeam: { name: '申花' } } : null, version: 1
  };
  const next: any = {
    id: 'lot-2', batchId: 'batch-1', displayOrder: 2, playerNameSnapshot: '唐伯虎',
    playerSnapshot: { card: { position: 'AMF', overallRating: 94 } }, startingPrice: 60,
    minimumIncrement: 10, status: 'QUEUED', deadlineAt: null, deadlineEpoch: 0,
    lastCountdownMark: null, pausedRemainingMs: null, version: 1
  };
  const lots = includeNext ? [current, next] : [current];
  const batch: any = {
    id: 'batch-1', status: 'ACTIVE', currentLotId: 'lot-1', version: 1,
    groupBinding: { deviceId: 'device-1', wechatGroupId: 'room@chatroom' }
  };
  const messages: any[] = [];
  const tx: any = {
    playerAuctionLot: {
      findUnique: jest.fn(async ({ where }: any) => lots.find((lot) => lot.id === where.id) ?? null),
      findFirst: jest.fn(async () => lots.filter((lot) => lot.status === 'QUEUED').sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))[0] ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const lot = lots.find((item) => item.id === where.id && item.status === where.status && item.deadlineEpoch === where.deadlineEpoch);
        if (!lot) return { count: 0 };
        applyData(lot, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => applyData(lots.find((lot) => lot.id === where.id), data))
    },
    playerAuctionBatch: {
      findUnique: jest.fn(async () => batch),
      update: jest.fn(async ({ data }: any) => applyData(batch, data))
    },
    wechatOutboxMessage: {
      create: jest.fn(async ({ data }: any) => { messages.push(data); return data; })
    }
  };
  const locks: any = {
    lockLot: jest.fn(async () => undefined),
    lockBatch: jest.fn(async () => undefined),
    now: jest.fn(async () => now)
  };
  const prisma: any = { $transaction: jest.fn(async (work: any) => work(tx)) };
  const worker = new PlayerAuctionWorker(
    prisma,
    { now: () => now } as never,
    locks,
    { enqueue: jest.fn() } as never,
    { scanUnavailableDevices: jest.fn() } as never,
    new PlayerAuctionMessageFormatter()
  );
  return { worker, current, next, batch, messages, tx, locks };
}

describe('PlayerAuctionWorker', () => {
  it('emits exactly the confirmed countdown marks for the current deadline epoch', async () => {
    let now = new Date('2026-10-09T12:00:10.000Z');
    const lot: any = {
      id: 'lot-1', status: 'ACTIVE', deadlineAt: new Date('2026-10-09T12:00:30.000Z'),
      deadlineEpoch: 2, lastCountdownMark: 30,
      batch: { groupBinding: { deviceId: 'device-1', wechatGroupId: 'room@chatroom' } }
    };
    const prisma: any = {
      playerAuctionLot: {
        findMany: jest.fn(async () => [lot]),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.lastCountdownMark !== lot.lastCountdownMark) return { count: 0 };
          lot.lastCountdownMark = data.lastCountdownMark;
          return { count: 1 };
        })
      },
      wechatOutboxMessage: { count: jest.fn(async () => 0) }
    };
    const outbox: any = { enqueue: jest.fn(async () => undefined) };
    const worker = new PlayerAuctionWorker(
      prisma,
      { now: () => now } as never,
      {} as never,
      outbox,
      { scanUnavailableDevices: jest.fn() } as never,
      new PlayerAuctionMessageFormatter()
    );

    for (const remaining of [20, 10, 5, 4, 3, 2, 1]) {
      now = new Date(lot.deadlineAt.getTime() - remaining * 1_000);
      await worker.tick();
    }

    expect(outbox.enqueue.mock.calls.map(([input]: any[]) => input.text)).toEqual(['20', '10', '3', '2', '1']);
    expect(outbox.enqueue.mock.calls.map(([input]: any[]) => input.text)).not.toEqual(expect.arrayContaining(['30', '5', '4', '0']));
  });

  it('closes a highest-bid lot, starts the next lot atomically, and is idempotent per epoch', async () => {
    const { worker, current, next, batch, messages, tx, locks } = closingHarness();

    await expect(worker.closeDueLot('lot-1', 3)).resolves.toBe(true);
    await expect(worker.closeDueLot('lot-1', 3)).resolves.toBe(false);

    expect(current.status).toBe('PENDING_REVIEW');
    expect(next).toMatchObject({ status: 'ACTIVE', deadlineEpoch: 1, lastCountdownMark: 30 });
    expect(next.deadlineAt.toISOString()).toBe('2026-10-09T12:01:00.000Z');
    expect(batch).toMatchObject({ status: 'ACTIVE', currentLotId: 'lot-2' });
    expect(locks.lockLot).toHaveBeenCalledWith(tx, 'lot-2');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ businessKey: 'auction:lot-1:epoch:3:closed' });
    expect(messages[1]).toMatchObject({ businessKey: 'auction:lot-2:epoch:1:opened' });
    expect(messages[0].priority).toBeGreaterThan(messages[1].priority);
    expect(messages[0].text).toContain('⭐120⭐');
    expect(messages[1].text).toContain('第2名球员拍卖开始');
  });

  it('records a no-bid lot for review and automatically starts the next lot', async () => {
    const { worker, current, next, batch, messages } = closingHarness({ highestBid: false });

    await expect(worker.closeDueLot('lot-1', 3)).resolves.toBe(true);

    expect(current.status).toBe('NO_BID');
    expect(next.status).toBe('ACTIVE');
    expect(batch.currentLotId).toBe('lot-2');
    expect(messages.map((message) => message.text).join('\n')).toContain('无人有效出价');
    expect(messages[1].text).toContain('唐伯虎');
  });

  it('completes the batch after the final lot and orders result before completion', async () => {
    const { worker, current, batch, messages } = closingHarness({ includeNext: false });

    await expect(worker.closeDueLot('lot-1', 3)).resolves.toBe(true);

    expect(current.status).toBe('PENDING_REVIEW');
    expect(batch).toMatchObject({ status: 'COMPLETED', currentLotId: null });
    expect(messages).toHaveLength(2);
    expect(messages[0].businessKey).toBe('auction:lot-1:epoch:3:closed');
    expect(messages[1].businessKey).toBe('auction:batch-1:completed');
    expect(messages[0].priority).toBeGreaterThan(messages[1].priority);
  });
});
