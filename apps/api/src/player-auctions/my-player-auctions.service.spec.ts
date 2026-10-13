/* eslint-disable @typescript-eslint/no-explicit-any -- focused room projection test doubles */
import { jest } from '@jest/globals';
import { MyPlayerAuctionsService } from './my-player-auctions.service.js';

const now = new Date('2026-10-09T12:00:00.000Z');

function harness(teamStatus = 'ACTIVE') {
  const team: any = { id: 'team-1', name: '申花', leagueId: 'league-1', status: teamStatus };
  const batch: any = {
    id: 'batch-1', leagueId: 'league-1', bidChannel: 'MINIPROGRAM', name: '秋季拍卖',
    status: 'ACTIVE', currentLotId: 'lot-1', league: { id: 'league-1', name: '九星联赛' },
    lots: [{
      id: 'lot-1', displayOrder: 1, playerNameSnapshot: '车范根', playerSnapshot: { position: 'CF' },
      startingPrice: 50, minimumIncrement: 10, status: 'ACTIVE', currentPrice: 120,
      deadlineAt: new Date('2026-10-09T12:00:20.000Z'), deadlineEpoch: 4,
      bids: [
        { id: 'bid-valid', leagueTeamId: 'team-1', amount: 120, result: 'VALID', submittedAt: now, leagueTeam: { name: '申花' }, wechatMessageId: 'secret' },
        { id: 'bid-failed', leagueTeamId: 'team-2', amount: 110, result: 'BELOW_MINIMUM_INCREMENT', submittedAt: now, leagueTeam: { name: '海港' }, wechatMessageId: 'secret-2' }
      ]
    }, {
      id: 'lot-2', displayOrder: 2, playerNameSnapshot: '济科', playerSnapshot: {},
      startingPrice: 80, minimumIncrement: 10, status: 'QUEUED', currentPrice: null,
      deadlineAt: null, deadlineEpoch: 0, bids: []
    }]
  };
  const prisma: any = {
    $queryRaw: jest.fn(async () => [{ databaseNow: now }]),
    leagueTeam: { findFirst: jest.fn(async () => teamStatus === 'ACTIVE' ? team : null) },
    playerAuctionBatch: {
      findFirst: jest.fn(async () => batch),
      findMany: jest.fn(async () => [batch])
    }
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
      expect.objectContaining({ id: 'bid-valid', amount: 120, teamName: '申花' })
    ]);
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
});
