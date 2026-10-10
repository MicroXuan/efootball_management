/* eslint-disable @typescript-eslint/no-explicit-any -- focused transactional Prisma test doubles */
import { jest } from '@jest/globals';
import { PlayerAuctionBidService } from './player-auction-bid.service.js';

describe('PlayerAuctionBidService', () => {
  it('accepts the starting price then requires the configured increment and resets 30 seconds', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const inbound: any = { id: 'in-1', deviceId: 'device-1', senderId: 'wx-1', groupBindingId: 'group-1', messageId: 'm-1', sequence: '001', wechatSentAt: now, receivedAt: now, groupBinding: { leagueId: 'league-1' } };
    const batch: any = { id: 'batch-1', status: 'ACTIVE', currentLotId: 'lot-1', leagueId: 'league-1' };
    const lot: any = { id: 'lot-1', status: 'ACTIVE', startingPrice: 50, minimumIncrement: 10, currentPrice: null, deadlineAt: new Date('2026-10-09T12:00:20.000Z'), deadlineEpoch: 0 };
    const bids: any[] = [];
    const tx: any = {
      wechatInboundMessage: { findUnique: jest.fn(async () => inbound) },
      playerAuctionBid: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => { const bid = { id: `bid-${bids.length + 1}`, ...data }; bids.push(bid); return bid; }),
        findMany: jest.fn(async () => [...bids].sort((left, right) => left.wechatSortKey.localeCompare(right.wechatSortKey))),
        update: jest.fn(async ({ where, data }: any) => Object.assign(bids.find((bid) => bid.id === where.id), data))
      },
      playerAuctionBatch: { findFirst: jest.fn(async () => batch) },
      playerAuctionLot: { findUnique: jest.fn(async () => lot), update: jest.fn(async ({ data }: any) => Object.assign(lot, data)) },
      wechatIdentityBinding: { findFirst: jest.fn(async () => ({ id: 'identity-1', userId: 'user-1', user: { status: 'ACTIVE' } })) },
      leagueTeam: { findFirst: jest.fn(async () => ({ id: 'team-1', name: '申花', leagueId: 'league-1' })) }
    };
    const service = new PlayerAuctionBidService(
      { $transaction: async (work: any) => work(tx) } as never,
      { lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) } as never
    );

    await expect(service.placeBid('in-1', 50)).resolves.toMatchObject({ result: 'VALID', amount: 50, teamName: '申花' });
    expect(lot.deadlineAt.toISOString()).toBe('2026-10-09T12:00:30.000Z');
    inbound.id = 'in-2'; inbound.messageId = 'm-2'; inbound.sequence = '002';
    await expect(service.placeBid('in-2', 55)).resolves.toMatchObject({ result: 'BELOW_MINIMUM_INCREMENT' });
  });

  it('audits unbound numeric bids instead of changing the active lot', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const create = jest.fn(async ({ data }: any) => ({ id: 'bid-1', ...data }));
    const tx: any = {
      wechatInboundMessage: { findUnique: jest.fn(async () => ({ id: 'in-1', deviceId: 'device-1', senderId: 'wx-1', groupBindingId: 'group-1', messageId: 'm-1', sequence: '001', wechatSentAt: now, receivedAt: now, groupBinding: { leagueId: 'league-1' } })) },
      playerAuctionBid: { findUnique: jest.fn(async () => null), create },
      playerAuctionBatch: { findFirst: jest.fn(async () => ({ id: 'batch-1', status: 'ACTIVE', currentLotId: 'lot-1', leagueId: 'league-1' })) },
      playerAuctionLot: { findUnique: jest.fn(async () => ({ id: 'lot-1', status: 'ACTIVE', startingPrice: 50, minimumIncrement: 10, currentPrice: null, deadlineAt: new Date('2026-10-09T12:00:30.000Z') })) },
      wechatIdentityBinding: { findFirst: jest.fn(async () => null) }
    };
    const service = new PlayerAuctionBidService({ $transaction: async (work: any) => work(tx) } as never, { lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) } as never);
    await expect(service.placeBid('in-1', 50)).resolves.toMatchObject({ result: 'UNBOUND' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ result: 'UNBOUND' }) }));
  });

  it('recomputes same-timestamp bids by the stable WeChat sort key instead of arrival order', async () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const inbound: any = { id: 'in-later', deviceId: 'device-1', senderId: 'wx-1', groupBindingId: 'group-1', messageId: 'm-later', sequence: '002', wechatSentAt: now, receivedAt: now, groupBinding: { leagueId: 'league-1' } };
    const lot: any = { id: 'lot-1', status: 'ACTIVE', startingPrice: 50, minimumIncrement: 10, currentPrice: null, deadlineAt: new Date('2026-10-09T12:00:20.000Z') };
    const bids: any[] = [];
    const tx: any = {
      wechatInboundMessage: { findUnique: jest.fn(async () => ({ ...inbound })) },
      playerAuctionBid: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => { const bid = { id: `bid-${bids.length + 1}`, ...data }; bids.push(bid); return bid; }),
        findMany: jest.fn(async () => [...bids].sort((left, right) => left.wechatSortKey.localeCompare(right.wechatSortKey))),
        update: jest.fn(async ({ where, data }: any) => Object.assign(bids.find((bid) => bid.id === where.id), data))
      },
      playerAuctionBatch: { findFirst: jest.fn(async () => ({ id: 'batch-1', status: 'ACTIVE', currentLotId: 'lot-1', leagueId: 'league-1' })) },
      playerAuctionLot: { findUnique: jest.fn(async () => lot), update: jest.fn(async ({ data }: any) => Object.assign(lot, data)) },
      wechatIdentityBinding: { findFirst: jest.fn(async () => ({ id: 'identity-1', userId: 'user-1', user: { status: 'ACTIVE' } })) },
      leagueTeam: { findFirst: jest.fn(async () => ({ id: 'team-1', name: '申花', leagueId: 'league-1' })) }
    };
    const service = new PlayerAuctionBidService({ $transaction: async (work: any) => work(tx) } as never, { lockGroup: jest.fn(), lockBatch: jest.fn(), lockLot: jest.fn(), now: jest.fn(async () => now) } as never);

    await expect(service.placeBid('in-later', 105)).resolves.toMatchObject({ result: 'VALID' });
    Object.assign(inbound, { id: 'in-earlier', messageId: 'm-earlier', sequence: '001' });
    await expect(service.placeBid('in-earlier', 100)).resolves.toMatchObject({ result: 'VALID' });

    expect(lot.currentPrice).toBe(100);
    expect(bids.find((bid) => bid.amount === 105)?.result).toBe('BELOW_MINIMUM_INCREMENT');
  });
});
