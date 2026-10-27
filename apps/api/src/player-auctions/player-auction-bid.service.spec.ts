/* eslint-disable @typescript-eslint/no-explicit-any -- focused transactional Prisma test doubles */
import { jest } from '@jest/globals';
import { PlayerAuctionBidService } from './player-auction-bid.service.js';

describe('PlayerAuctionBidService', () => {
  function miniprogramHarness(overrides: {
    batch?: Record<string, unknown>;
    lot?: Record<string, unknown>;
    team?: Record<string, unknown> | null;
  } = {}) {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const batch: any = {
      id: 'batch-1', bidChannel: 'MINIPROGRAM', status: 'ACTIVE', currentLotId: 'lot-1',
      leagueId: 'league-1', ...overrides.batch
    };
    const lot: any = {
      id: 'lot-1', batchId: 'batch-1', status: 'ACTIVE', startingPrice: 50,
      minimumIncrement: 10, currentPrice: null,
      deadlineAt: new Date('2026-10-09T12:00:20.000Z'), deadlineEpoch: 4,
      ...overrides.lot
    };
    const team = overrides.team === undefined
      ? { id: 'team-1', name: '申花', leagueId: 'league-1', status: 'ACTIVE' }
      : overrides.team;
    const bids: any[] = [];
    let deadlineUpdates = 0;
    const tx: any = {
      $queryRaw: jest.fn(async () => []),
      playerAuctionBatch: {
        findUnique: jest.fn(async () => batch),
        findFirst: jest.fn(async () => batch)
      },
      playerAuctionLot: {
        findUnique: jest.fn(async () => lot),
        update: jest.fn(async ({ data }: any) => {
          if (data.deadlineAt) deadlineUpdates += 1;
          const epochIncrement = data.deadlineEpoch?.increment ?? 0;
          const plainData = { ...data };
          delete plainData.deadlineEpoch;
          Object.assign(lot, plainData);
          lot.deadlineEpoch += epochIncrement;
          return lot;
        })
      },
      playerAuctionBid: {
        findUnique: jest.fn(async ({ where }: any) => {
          const key = where.lotId_userId_idempotencyKey;
          if (!key) return null;
          return bids.find((bid) => bid.lotId === key.lotId && bid.userId === key.userId && bid.idempotencyKey === key.idempotencyKey) ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const bid = { id: `bid-${bids.length + 1}`, ...data };
          bids.push(bid);
          return bid;
        }),
        findMany: jest.fn(async ({ where }: any) => bids.filter((bid) => !where?.result?.in || where.result.in.includes(bid.result)).sort((left, right) => left.submittedAt.getTime() - right.submittedAt.getTime() || left.id.localeCompare(right.id))),
        update: jest.fn(async ({ where, data }: any) => Object.assign(bids.find((bid) => bid.id === where.id), data))
      },
      leagueTeam: { findFirst: jest.fn(async () => team) }
    };
    const locks = {
      lockLeague: jest.fn(), lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(),
      now: jest.fn(async () => now)
    };
    const service = new PlayerAuctionBidService(
      { $transaction: async (work: any) => work(tx) } as never,
      locks as never
    );
    return { service, tx, locks, batch, lot, bids, now, deadlineUpdates: () => deadlineUpdates };
  }

  it('accepts the starting price then requires the configured increment and resets 30 seconds', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const inbound: any = { id: 'in-1', deviceId: 'device-1', senderId: 'wx-1', groupBindingId: 'group-1', messageId: 'm-1', sequence: '001', wechatSentAt: now, receivedAt: now, groupBinding: { leagueId: 'league-1' } };
    const batch: any = { id: 'batch-1', bidChannel: 'WECHAT_GROUP', status: 'ACTIVE', currentLotId: 'lot-1', leagueId: 'league-1' };
    const lot: any = { id: 'lot-1', status: 'ACTIVE', startingPrice: 50, minimumIncrement: 10, currentPrice: null, deadlineAt: new Date('2026-10-09T12:00:20.000Z'), deadlineEpoch: 0 };
    const bids: any[] = [];
    const tx: any = {
      $queryRaw: jest.fn(async () => []),
      wechatInboundMessage: { findUnique: jest.fn(async () => inbound) },
      playerAuctionBid: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => { const bid = { id: `bid-${bids.length + 1}`, ...data }; bids.push(bid); return bid; }),
        findMany: jest.fn(async () => [...bids].sort((left, right) => left.wechatSortKey.localeCompare(right.wechatSortKey))),
        update: jest.fn(async ({ where, data }: any) => Object.assign(bids.find((bid) => bid.id === where.id), data))
      },
      playerAuctionBatch: { findFirst: jest.fn(async () => batch) },
      playerAuctionLot: { findUnique: jest.fn(async () => lot), update: jest.fn(async ({ data }: any) => Object.assign(lot, data)) },
      wechatIdentityBinding: { findFirst: jest.fn(async () => ({ id: 'identity-1', userId: 'user-1', boundAt: new Date('2026-10-01'), user: { status: 'ACTIVE' } })) },
      leagueTeam: { findFirst: jest.fn(async () => ({ id: 'team-1', name: '申花', leagueId: 'league-1' })) }
    };
    const service = new PlayerAuctionBidService(
      { $transaction: async (work: any) => work(tx) } as never,
      { lockLeague: jest.fn(), lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) } as never
    );

    await expect(service.placeBid('in-1', 50)).resolves.toMatchObject({ result: 'VALID', amount: 50, teamName: '申花' });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.wechatIdentityBinding.findFirst.mock.invocationCallOrder[0]);
    expect(lot.deadlineAt.toISOString()).toBe('2026-10-09T12:00:30.000Z');
    inbound.id = 'in-2'; inbound.messageId = 'm-2'; inbound.sequence = '002';
    await expect(service.placeBid('in-2', 55)).resolves.toMatchObject({ result: 'BELOW_MINIMUM_INCREMENT' });
  });

  it('rejects first-delivered pre-binding bids and pre-rebinding backlog, accepting only new bids', async () => {
    const { service, tx, bids, now } = miniprogramHarness({ batch: { bidChannel: 'WECHAT_GROUP' } });
    let boundAt = new Date(now.getTime() + 1000);
    const inbound = { id: 'old-first-delivery', deviceId: 'device-1', senderId: 'wx-1', groupBindingId: 'group-1', messageId: 'old-first-delivery', sequence: '001', wechatSentAt: now, receivedAt: new Date(now.getTime() + 5000), groupBinding: { leagueId: 'league-1' } };
    tx.wechatInboundMessage = { findUnique: async () => inbound };
    tx.wechatIdentityBinding = { findFirst: async () => ({ id: 'identity-1', userId: 'user-1', boundAt, user: { status: 'ACTIVE' } }) };
    await expect(service.placeBid(inbound.id, 50)).resolves.toMatchObject({ result: 'UNBOUND', userId: null, identityBindingId: null });
    expect(bids[0].result).toBe('UNBOUND');
    Object.assign(inbound, { id: 'new', messageId: 'new', sequence: '002', wechatSentAt: new Date(now.getTime() + 2000) });
    await expect(service.placeBid(inbound.id, 50)).resolves.toMatchObject({ result: 'VALID', userId: 'user-1' });
    boundAt = new Date(now.getTime() + 3000);
    Object.assign(inbound, { id: 'before-rebind', messageId: 'before-rebind', sequence: '003' });
    await expect(service.placeBid(inbound.id, 60)).resolves.toMatchObject({ result: 'UNBOUND', identityBindingId: null });
  });

  it('audits unbound numeric bids instead of changing the active lot', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const create = jest.fn(async ({ data }: any) => ({ id: 'bid-1', ...data }));
    const tx: any = {
      $queryRaw: jest.fn(async () => []),
      wechatInboundMessage: { findUnique: jest.fn(async () => ({ id: 'in-1', deviceId: 'device-1', senderId: 'wx-1', groupBindingId: 'group-1', messageId: 'm-1', sequence: '001', wechatSentAt: now, receivedAt: now, groupBinding: { leagueId: 'league-1' } })) },
      playerAuctionBid: { findUnique: jest.fn(async () => null), create },
      playerAuctionBatch: { findFirst: jest.fn(async () => ({ id: 'batch-1', bidChannel: 'WECHAT_GROUP', status: 'ACTIVE', currentLotId: 'lot-1', leagueId: 'league-1' })) },
      playerAuctionLot: { findUnique: jest.fn(async () => ({ id: 'lot-1', status: 'ACTIVE', startingPrice: 50, minimumIncrement: 10, currentPrice: null, deadlineAt: new Date('2026-10-09T12:00:30.000Z') })) },
      wechatIdentityBinding: { findFirst: jest.fn(async () => null) }
    };
    const service = new PlayerAuctionBidService({ $transaction: async (work: any) => work(tx) } as never, { lockLeague: jest.fn(), lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) } as never);
    await expect(service.placeBid('in-1', 50)).resolves.toMatchObject({ result: 'UNBOUND' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ result: 'UNBOUND' }) }));
  });

  it('recomputes same-timestamp bids by the stable WeChat sort key instead of arrival order', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const inbound: any = { id: 'in-later', deviceId: 'device-1', senderId: 'wx-1', groupBindingId: 'group-1', messageId: 'm-later', sequence: '002', wechatSentAt: now, receivedAt: now, groupBinding: { leagueId: 'league-1' } };
    const lot: any = { id: 'lot-1', status: 'ACTIVE', startingPrice: 50, minimumIncrement: 10, currentPrice: null, deadlineAt: new Date('2026-10-09T12:00:20.000Z') };
    const bids: any[] = [];
    const tx: any = {
      $queryRaw: jest.fn(async () => []),
      wechatInboundMessage: { findUnique: jest.fn(async () => ({ ...inbound })) },
      playerAuctionBid: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => { const bid = { id: `bid-${bids.length + 1}`, ...data }; bids.push(bid); return bid; }),
        findMany: jest.fn(async () => [...bids].sort((left, right) => left.wechatSortKey.localeCompare(right.wechatSortKey))),
        update: jest.fn(async ({ where, data }: any) => Object.assign(bids.find((bid) => bid.id === where.id), data))
      },
      playerAuctionBatch: { findFirst: jest.fn(async () => ({ id: 'batch-1', bidChannel: 'WECHAT_GROUP', status: 'ACTIVE', currentLotId: 'lot-1', leagueId: 'league-1' })) },
      playerAuctionLot: { findUnique: jest.fn(async () => lot), update: jest.fn(async ({ data }: any) => Object.assign(lot, data)) },
      wechatIdentityBinding: { findFirst: jest.fn(async () => ({ id: 'identity-1', userId: 'user-1', boundAt: new Date('2026-10-01'), user: { status: 'ACTIVE' } })) },
      leagueTeam: { findFirst: jest.fn(async () => ({ id: 'team-1', name: '申花', leagueId: 'league-1' })) }
    };
    const service = new PlayerAuctionBidService({ $transaction: async (work: any) => work(tx) } as never, { lockLeague: jest.fn(), lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) } as never);

    await expect(service.placeBid('in-later', 105)).resolves.toMatchObject({ result: 'VALID' });
    Object.assign(inbound, { id: 'in-earlier', messageId: 'm-earlier', sequence: '001' });
    await expect(service.placeBid('in-earlier', 100)).resolves.toMatchObject({ result: 'VALID' });

    expect(lot.currentPrice).toBe(100);
    expect(bids.find((bid) => bid.amount === 105)?.result).toBe('BELOW_MINIMUM_INCREMENT');
  });

  it('rejects a group bid when the active batch uses the miniprogram channel', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const tx: any = {
      $queryRaw: jest.fn(async () => []),
      wechatInboundMessage: { findUnique: jest.fn(async () => ({
        id: 'in-1', deviceId: 'device-1', senderId: 'wx-1', groupBindingId: 'group-1',
        messageId: 'm-1', sequence: '001', wechatSentAt: now, receivedAt: now,
        groupBinding: { id: 'group-1', leagueId: 'league-1' }
      })) },
      playerAuctionBid: { findUnique: jest.fn(async () => null), create: jest.fn() },
      playerAuctionBatch: { findFirst: jest.fn(async () => ({
        id: 'batch-1', bidChannel: 'MINIPROGRAM', status: 'ACTIVE', currentLotId: 'lot-1', leagueId: 'league-1'
      })) }
    };
    const service = new PlayerAuctionBidService(
      { $transaction: async (work: any) => work(tx) } as never,
      { lockLeague: jest.fn(), lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) } as never
    );

    await expect(service.placeBid('in-1', 50)).rejects.toMatchObject({ code: 'AUCTION_CHANNEL_MISMATCH' });
    expect(tx.playerAuctionBid.create).not.toHaveBeenCalled();
  });

  it('accepts an active-team miniprogram bid using database time and resets exactly 30 seconds', async () => {
    const { service, locks, bids, lot, now } = miniprogramHarness();
    const input = {
      amount: 50, lotId: 'lot-1', deadlineEpoch: 4,
      submittedAt: '1999-01-01T00:00:00.000Z'
    };

    await expect(service.placeMiniprogramBid('user-1', 'batch-1', input, 'request-1')).resolves.toMatchObject({
      result: 'VALID', amount: 50, teamName: '申花'
    });

    expect(locks.lockLeague).toHaveBeenCalledWith(expect.anything(), 'league-1');
    expect(bids[0]).toMatchObject({
      source: 'MINIPROGRAM', userId: 'user-1', idempotencyKey: 'request-1',
      wechatMessageId: null, wechatSentAt: null, submittedAt: now
    });
    expect(lot.deadlineAt.toISOString()).toBe('2026-10-09T12:00:30.000Z');
  });

  it('rejects a miniprogram bid when the user no longer has an active team', async () => {
    const { service, tx } = miniprogramHarness({ team: null });

    await expect(service.placeMiniprogramBid('user-1', 'batch-1', {
      amount: 50, lotId: 'lot-1', deadlineEpoch: 4
    }, 'request-1')).rejects.toMatchObject({ code: 'NO_ACTIVE_TEAM' });
    expect(tx.playerAuctionBid.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ amount: 50, lotId: 'lot-old', deadlineEpoch: 4 }],
    [{ amount: 50, lotId: 'lot-1', deadlineEpoch: 3 }]
  ])('rejects stale miniprogram lot or epoch without inserting', async (input) => {
    const { service, tx } = miniprogramHarness();

    await expect(service.placeMiniprogramBid('user-1', 'batch-1', input, 'request-stale'))
      .rejects.toMatchObject({ code: 'AUCTION_EPOCH_CHANGED' });
    expect(tx.playerAuctionBid.create).not.toHaveBeenCalled();
  });

  it('returns the original idempotent miniprogram bid without resetting the deadline twice', async () => {
    const harness = miniprogramHarness();
    const input = { amount: 50, lotId: 'lot-1', deadlineEpoch: 4 };

    const first = await harness.service.placeMiniprogramBid('user-1', 'batch-1', input, 'request-1');
    const second = await harness.service.placeMiniprogramBid('user-1', 'batch-1', input, 'request-1');

    expect(second.id).toBe(first.id);
    expect(harness.bids).toHaveLength(1);
    expect(harness.deadlineUpdates()).toBe(1);
  });

  it('accepts distinct miniprogram request keys as consecutive bids at the latest epoch', async () => {
    const harness = miniprogramHarness();

    await expect(harness.service.placeMiniprogramBid('user-1', 'batch-1', {
      amount: 50, lotId: 'lot-1', deadlineEpoch: 4
    }, 'request-1')).resolves.toMatchObject({ result: 'VALID' });
    await expect(harness.service.placeMiniprogramBid('user-1', 'batch-1', {
      amount: 60, lotId: 'lot-1', deadlineEpoch: 5
    }, 'request-2')).resolves.toMatchObject({ result: 'VALID', amount: 60 });

    expect(harness.bids).toHaveLength(2);
    expect(harness.deadlineUpdates()).toBe(2);
  });
});
