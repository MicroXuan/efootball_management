/* eslint-disable @typescript-eslint/no-explicit-any -- focused room projection test doubles */
import { jest } from '@jest/globals';
import { MyPlayerAuctionsService } from './my-player-auctions.service.js';

const now = new Date('2026-10-09T12:00:00.000Z');
const saleCardId = '22222222-2222-4222-8222-222222222222';

function harness(teamStatus = 'ACTIVE') {
  const team: any = { id: 'team-1', name: '申花', leagueId: 'league-1', status: teamStatus };
  const batch: any = {
    id: 'batch-1', leagueId: 'league-1', bidChannel: 'MINIPROGRAM', name: '秋季拍卖',
    status: 'ACTIVE', currentLotId: 'lot-1', league: { id: 'league-1', name: '九星联赛' },
    lots: [{
      id: 'lot-1', displayOrder: 1, playerNameSnapshot: '车范根', playerSnapshot: { card: {
        id: saleCardId, imageUrl: 'https://img.pesdata.net/player.webp', cardName: '传奇',
        position: 'CF', overallRating: 96, cardType: 'EPIC'
      } },
      startingPrice: 50, minimumIncrement: 10, status: 'ACTIVE', currentPrice: 120,
      deadlineAt: new Date('2026-10-09T12:00:20.000Z'), deadlineEpoch: 4,
      bids: [
        {
          id: 'bid-valid', leagueTeamId: 'team-1', amount: 120, result: 'VALID', submittedAt: now,
          leagueTeam: { teamNumber: 1, name: '申花' }, user: { displayName: '梅西' }, wechatMessageId: 'secret'
        },
        {
          id: 'bid-newer', leagueTeamId: 'team-2', amount: 130, result: 'VALID',
          submittedAt: new Date('2026-10-09T12:00:01.000Z'),
          leagueTeam: { teamNumber: 2, name: '海港' }, user: { displayName: '小新' }, wechatMessageId: 'secret-new'
        },
        {
          id: 'bid-failed', leagueTeamId: 'team-2', amount: 110, result: 'BELOW_MINIMUM_INCREMENT', submittedAt: now,
          leagueTeam: { teamNumber: 2, name: '海港' }, user: { displayName: '小新' }, wechatMessageId: 'secret-2'
        }
      ]
    }, {
      id: 'lot-2', displayOrder: 2, playerNameSnapshot: '济科', playerSnapshot: { card: {
        id: saleCardId, imageUrl: null, cardName: '传奇', position: 'AMF', overallRating: 95, cardType: 'LEGENDARY'
      } },
      startingPrice: 80, minimumIncrement: 10, status: 'QUEUED', currentPrice: null,
      deadlineAt: null, deadlineEpoch: 0, bids: []
    }]
  };
  const prisma: any = {
    $queryRaw: jest.fn(async () => [{ databaseNow: now }]),
    leagueTeam: {
      findFirst: jest.fn(async () => teamStatus === 'ACTIVE' ? team : null),
      findMany: jest.fn(async () => teamStatus === 'ACTIVE' ? [team] : [])
    },
    playerAuctionBatch: {
      findFirst: jest.fn(async () => batch),
      findMany: jest.fn(async () => [batch])
    },
    playerAuctionReview: { findMany: jest.fn(async () => [{
      id: '11111111-1111-4111-8111-111111111111',
      decision: 'CONFIRM',
      reviewedWinnerTeamId: 'team-1',
      reviewedPrice: 120,
      winnerTeamNumberSnapshot: 1,
      winnerTeamNameSnapshot: '旧申花',
      winnerDisplayNameSnapshot: '旧梅西',
      reviewedAt: now,
      reviewedWinnerTeam: { teamNumber: 99, name: '新申花', owner: { displayName: '新梅西' } },
      lot: {
        footballPlayerId: 'player-1',
        playerCardId: saleCardId,
        playerNameSnapshot: '车范根',
        playerSnapshot: { card: {
          id: saleCardId, imageUrl: 'https://img.pesdata.net/player.webp', cardName: '传奇',
          position: 'CF', overallRating: 96, cardType: 'EPIC'
        } },
        batch: { id: 'batch-1', league: { id: 'league-1', name: '九星联赛' } },
        playerCard: null
      }
    }]) }
  };
  const bids: any = { placeMiniprogramBid: jest.fn(async () => ({ id: 'bid-new', result: 'VALID' })) };
  return { service: new MyPlayerAuctionsService(prisma, bids), prisma, bids, batch };
}

describe('MyPlayerAuctionsService', () => {
  it('projects an active room without failed bids or WeChat identifiers', async () => {
    const { service } = harness();
    const room = await service.detail('user-1', 'batch-1');

    expect(room).toMatchObject({
      batchId: 'batch-1', serverNow: now.toISOString(), canBid: true,
      minimumValidPrice: 130, sharePath: '/pages/auction-room/index?batchId=batch-1',
      team: { id: 'team-1', name: '申花' }
    });
    expect(room.currentLot).not.toBeNull();
    expect(room.currentLot!.bids).toEqual([
      {
        id: 'bid-newer', teamNumber: 2, teamName: '海港', bidderDisplayName: '小新',
        amount: 130, submittedAt: '2026-10-09T12:00:01.000Z'
      },
      {
        id: 'bid-valid', teamNumber: 1, teamName: '申花', bidderDisplayName: '梅西',
        amount: 120, submittedAt: now.toISOString()
      }
    ]);
    expect(room.currentLot!.card).toMatchObject({ id: saleCardId, overallRating: 96, position: 'CF' });
    expect(JSON.stringify(room)).not.toContain('wechatMessageId');
    expect(JSON.stringify(room)).not.toContain('bid-failed');
  });

  it('denies room access after the league team becomes inactive', async () => {
    const { service } = harness('ARCHIVED');
    await expect(service.detail('user-1', 'batch-1')).rejects.toMatchObject({ code: 'NO_ACTIVE_TEAM' });
  });

  it('delegates bids with only authenticated user, batch, request, and idempotency key', async () => {
    const { service, bids } = harness();
    const input = { amount: 130, lotId: 'lot-1', deadlineEpoch: 4 };
    await service.placeBid('user-1', 'batch-1', input, 'request-1');
    expect(bids.placeMiniprogramBid).toHaveBeenCalledWith('user-1', 'batch-1', input, 'request-1');
  });

  it('lists only immutable confirmed sales in active-team leagues with stable search pagination', async () => {
    const { service, prisma } = harness();
    const result = await service.listSales('user-1', { keyword: '  01  ', limit: 1 });

    expect(prisma.playerAuctionReview.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        decision: { in: ['CONFIRM', 'ADJUST'] },
        reviewedWinnerTeamId: { not: null },
        reviewedPrice: { not: null },
        lot: { batch: { leagueId: { in: ['league-1'] } } },
        OR: expect.arrayContaining([
          { winnerTeamNameSnapshot: { contains: '01' } },
          { winnerDisplayNameSnapshot: { contains: '01' } },
          { winnerTeamNumberSnapshot: 1 }
        ])
      }),
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      take: 2
    }));
    expect(result).toEqual({
      items: [{
        id: '11111111-1111-4111-8111-111111111111',
        batchId: 'batch-1',
        league: { id: 'league-1', name: '九星联赛' },
        player: {
          id: 'player-1', cardId: saleCardId, name: '车范根',
          imageUrl: 'https://img.pesdata.net/player.webp', position: 'CF', overallRating: 96, cardType: 'EPIC'
        },
        winner: { teamId: 'team-1', teamNumber: 1, teamName: '旧申花', bidderDisplayName: '旧梅西' },
        price: 120,
        confirmedAt: now.toISOString()
      }],
      nextCursor: null
    });
  });

  it('returns no sale history when the user has no active league team', async () => {
    const { service, prisma } = harness('ARCHIVED');
    await expect(service.listSales('user-1', { limit: 20 })).resolves.toEqual({ items: [], nextCursor: null });
    expect(prisma.playerAuctionReview.findMany).not.toHaveBeenCalled();
  });
});
