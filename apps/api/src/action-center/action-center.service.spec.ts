/* eslint-disable @typescript-eslint/no-explicit-any -- focused action-center projection fixtures */
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ActionCenterResponseSchema } from '@efm/contracts';
import { ActionCenterService } from './action-center.service.js';

const at = new Date('2026-10-15T12:00:00.000Z');
const league = { id: 'league-1', name: 'CELL 联赛', currentSeasonId: 'season-1' };
const mine = { id: 'team-1', name: '申花', leagueId: league.id, league };
const rival = { id: 'team-2', name: '海港' };
const player = { nameZh: '劳塔罗', nameEn: 'Lautaro', shortName: 'Lautaro' };

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(at); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

function application(input: Partial<any>) {
  return {
    id: 'application-1', leagueId: league.id, seasonId: 'season-1', applicantLeagueTeamId: mine.id,
    sourceLeagueTeamId: null, type: 'NORMAL_PURCHASE', status: 'PENDING', updatedAt: at,
    league, applicantLeagueTeam: mine, sourceLeagueTeam: null, footballPlayer: player,
    ...input,
  };
}

function harness(options: {
  teams?: any[];
  applications?: any[];
  currentApplications?: any[];
  recentApplications?: any[];
  auctions?: any[];
  currentMatches?: any[];
  recentMatches?: any[];
} = {}) {
  const applicationFindMany = jest.fn(async (args: any) => {
    if (options.currentApplications || options.recentApplications) {
      return args.where.status?.in ? options.currentApplications ?? [] : options.recentApplications ?? [];
    }
    return options.applications ?? [];
  });
  const prisma: any = {
    leagueTeam: { findMany: jest.fn(async () => options.teams ?? [mine]) },
    playerAcquisitionApplication: { findMany: applicationFindMany },
    playerAuctionBatch: { findMany: jest.fn(async () => options.auctions ?? []) },
    competitionMatch: { findMany: jest.fn(async (args: any) => args.where.updatedAt
      ? options.recentMatches ?? [] : options.currentMatches ?? []) },
  };
  return { service: new ActionCenterService(prisma), prisma };
}

function match(input: Partial<any> = {}) {
  return {
    id: 'match-1', status: 'PENDING_CONFIRMATION', updatedAt: at,
    resultConfirmationDeadlineAt: new Date('2026-10-16T12:00:00.000Z'),
    stage: { competition: { name: '十月杯', seasonId: 'season-1', season: { league } } },
    homeParticipant: { displayNameSnapshot: '申花', individualUserId: null,
      seasonEntry: { ownerUserId: 'user-1', leagueTeam: { id: mine.id, status: 'ACTIVE' } } },
    awayParticipant: { displayNameSnapshot: '海港', individualUserId: null,
      seasonEntry: { ownerUserId: 'user-2', leagueTeam: { id: rival.id, status: 'ACTIVE' } } },
    resultVersions: [{ id: 'result-1', submittedById: 'user-2', homeScore: 2, awayScore: 1, updatedAt: at }],
    resultDisputes: [], officialResultVersion: null,
    ...input,
  };
}

describe('ActionCenterService', () => {
  it('preserves every current application alongside capped recent application history', async () => {
    const validLeague = { ...league, id: randomUUID(), currentSeasonId: randomUUID() };
    const validTeam = { ...mine, id: randomUUID(), leagueId: validLeague.id, league: validLeague };
    const currentApplications = [application({ id: randomUUID(), status: 'REQUOTE_REQUIRED',
      leagueId: validLeague.id, league: validLeague, seasonId: validLeague.currentSeasonId,
      applicantLeagueTeamId: validTeam.id, applicantLeagueTeam: validTeam })];
    const recentApplications = Array.from({ length: 100 }, () => ({ ...currentApplications[0], id: randomUUID(), status: 'APPROVED' }));
    const result = await harness({ teams: [validTeam], currentApplications, recentApplications }).service.get('user-1');

    expect(result.items).toHaveLength(101);
    expect(result.actionRequiredCount).toBe(1);
    expect(ActionCenterResponseSchema.parse(result).items).toHaveLength(101);
  });

  it('returns an empty center when the user has no active league team', async () => {
    const { service, prisma } = harness({ teams: [] });

    await expect(service.get('user-1')).resolves.toEqual({ items: [], actionRequiredCount: 0 });
    expect(prisma.playerAcquisitionApplication.findMany).not.toHaveBeenCalled();
    expect(prisma.playerAuctionBatch.findMany).not.toHaveBeenCalled();
  });

  it('does not query or project legacy match-result rows', async () => {
    const { service, prisma } = harness({ currentMatches: [match()], recentMatches: [match({ status: 'CONFIRMED' })] });

    await expect(service.get('user-1')).resolves.toEqual({ items: [], actionRequiredCount: 0 });
    expect(prisma.competitionMatch.findMany).not.toHaveBeenCalled();
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

  it('never asks the forced-transfer recipient to requote and preserves terminal result labels', async () => {
    const incoming = (status: string, id: string) => application({
      id,
      applicantLeagueTeamId: rival.id,
      applicantLeagueTeam: rival,
      sourceLeagueTeamId: mine.id,
      sourceLeagueTeam: mine,
      type: 'FORCED_TRANSFER',
      status,
    });
    const { service } = harness({
      applications: [incoming('REQUOTE_REQUIRED', 'forced-requote'), incoming('APPROVED', 'forced-approved')],
    });

    const result = await service.get('user-1');

    expect(result.actionRequiredCount).toBe(0);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'forced:forced-requote', section: 'STATUS_UPDATE', statusLabel: '对方需重新报价' }),
      expect.objectContaining({ id: 'forced:forced-approved', section: 'RECENT', statusLabel: '强报已通过' }),
    ]));
  });

  it('queries all current applications separately from the capped recent history', async () => {
    const required = application({ id: 'required-old', status: 'REQUOTE_REQUIRED', updatedAt: new Date('2026-08-01T00:00:00.000Z') });
    const recent = Array.from({ length: 100 }, (_, index) => application({
      id: `recent-${index}`,
      status: 'APPROVED',
      updatedAt: new Date(at.getTime() - index * 1000),
    }));
    const { service, prisma } = harness({ currentApplications: [required], recentApplications: recent });

    const result = await service.get('user-1');

    expect(result.actionRequiredCount).toBe(1);
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'application:required-old' })]));
    expect(prisma.playerAcquisitionApplication.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.playerAcquisitionApplication.findMany.mock.calls[0][0]).not.toHaveProperty('take');
    expect(prisma.playerAcquisitionApplication.findMany.mock.calls[1][0]).toMatchObject({ take: 100 });
  });

  it('excludes active teams that belong to soft-deleted leagues', async () => {
    const { service, prisma } = harness({ teams: [] });

    await service.get('user-1');

    expect(prisma.leagueTeam.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerUserId: 'user-1', status: 'ACTIVE', league: { isDeleted: false } },
    }));
  });

});
