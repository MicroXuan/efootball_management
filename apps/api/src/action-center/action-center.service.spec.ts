/* eslint-disable @typescript-eslint/no-explicit-any -- focused action-center projection fixtures */
import { jest } from '@jest/globals';
import { ActionCenterService } from './action-center.service.js';

const at = new Date('2026-10-15T12:00:00.000Z');
const league = { id: 'league-1', name: 'CELL 联赛', currentSeasonId: 'season-1' };
const mine = { id: 'team-1', name: '申花', leagueId: league.id, league };
const rival = { id: 'team-2', name: '海港' };
const player = { nameZh: '劳塔罗', nameEn: 'Lautaro', shortName: 'Lautaro' };

function application(input: Partial<any>) {
  return {
    id: 'application-1', leagueId: league.id, seasonId: 'season-1', applicantLeagueTeamId: mine.id,
    sourceLeagueTeamId: null, type: 'NORMAL_PURCHASE', status: 'PENDING', updatedAt: at,
    league, applicantLeagueTeam: mine, sourceLeagueTeam: null, footballPlayer: player,
    ...input,
  };
}

function harness(options: { teams?: any[]; applications?: any[]; auctions?: any[] } = {}) {
  const prisma: any = {
    leagueTeam: { findMany: jest.fn(async () => options.teams ?? [mine]) },
    playerAcquisitionApplication: { findMany: jest.fn(async () => options.applications ?? []) },
    playerAuctionBatch: { findMany: jest.fn(async () => options.auctions ?? []) },
  };
  return { service: new ActionCenterService(prisma), prisma };
}

describe('ActionCenterService', () => {
  it('returns an empty center when the user has no active league team', async () => {
    const { service, prisma } = harness({ teams: [] });

    await expect(service.get('user-1')).resolves.toEqual({ items: [], actionRequiredCount: 0 });
    expect(prisma.playerAcquisitionApplication.findMany).not.toHaveBeenCalled();
    expect(prisma.playerAuctionBatch.findMany).not.toHaveBeenCalled();
  });

  it('projects transactions, incoming forced transfers, and active auctions with exact deep links', async () => {
    const applications = [
      application({ status: 'REQUOTE_REQUIRED' }),
      application({ id: 'forced-in', applicantLeagueTeamId: rival.id, applicantLeagueTeam: rival,
        sourceLeagueTeamId: mine.id, sourceLeagueTeam: mine, type: 'FORCED_TRANSFER', status: 'PENDING' }),
      application({ id: 'forced-own', sourceLeagueTeamId: mine.id, sourceLeagueTeam: mine,
        type: 'FORCED_TRANSFER', status: 'PENDING' }),
    ];
    const auctions = [{
      id: 'batch-1', leagueId: league.id, name: '十月拍卖', status: 'ACTIVE', updatedAt: at,
      league, currentLot: { playerNameSnapshot: '济科' },
    }];
    const { service } = harness({ applications, auctions });

    const result = await service.get('user-1');

    expect(result.actionRequiredCount).toBe(2);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'application:application-1', source: 'TRANSACTION', section: 'ACTION_REQUIRED',
        route: '/pages/player-market/index?leagueId=league-1&seasonId=season-1&teamId=team-1&view=mine' }),
      expect.objectContaining({ id: 'forced:forced-in', source: 'FORCED_TRANSFER', section: 'STATUS_UPDATE',
        route: '/pages/player-market/index?leagueId=league-1&seasonId=season-1&teamId=team-1&view=public' }),
      expect.objectContaining({ id: 'application:forced-own', source: 'FORCED_TRANSFER', section: 'STATUS_UPDATE' }),
      expect.objectContaining({ id: 'auction:batch-1', source: 'AUCTION', section: 'ACTION_REQUIRED',
        route: '/pages/auction-room/index?batchId=batch-1' }),
    ]));
    expect(result.items.filter((item: any) => item.id.includes('forced-own'))).toHaveLength(1);
  });

  it('keeps completed application updates recent without counting them as required actions', async () => {
    const { service } = harness({ applications: [application({ status: 'APPROVED' })] });

    const result = await service.get('user-1');

    expect(result.actionRequiredCount).toBe(0);
    expect(result.items[0]).toMatchObject({ section: 'RECENT', statusLabel: '已通过' });
  });
});
