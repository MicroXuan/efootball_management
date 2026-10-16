/* eslint-disable @typescript-eslint/no-explicit-any -- focused action-center projection fixtures */
import { jest } from '@jest/globals';
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

  it('asks the opponent to confirm while the original submitter only waits', async () => {
    const opponent = await harness({ currentMatches: [match()] }).service.get('user-1');
    const submitter = await harness({ currentMatches: [match({ resultVersions: [{ id: 'result-1', submittedById: 'user-1', homeScore: 2, awayScore: 1, updatedAt: at }] })] }).service.get('user-1');

    expect(opponent.items).toEqual([expect.objectContaining({ id: 'match-result:match-1', source: 'MATCH_RESULT', section: 'ACTION_REQUIRED', title: '确认比分', route: '/pages/match-result/index?id=match-1' })]);
    expect(opponent.actionRequiredCount).toBe(1);
    expect(submitter.items).toEqual([expect.objectContaining({ section: 'STATUS_UPDATE' })]);
    expect(submitter.actionRequiredCount).toBe(0);
  });

  it('recognizes an away-side current user as the opponent who must confirm', async () => {
    const away = match({
      homeParticipant: { displayNameSnapshot: '海港', seasonEntry: { ownerUserId: 'user-2', leagueTeam: { id: rival.id, status: 'ACTIVE' } } },
      awayParticipant: { displayNameSnapshot: '申花', seasonEntry: { ownerUserId: 'user-1', leagueTeam: { id: mine.id, status: 'ACTIVE' } } },
    });
    const result = await harness({ currentMatches: [away] }).service.get('user-1');

    expect(result.items[0]).toMatchObject({ section: 'ACTION_REQUIRED', teamId: mine.id, title: '确认比分' });
    expect(result.actionRequiredCount).toBe(1);
  });

  it('offers a timeout dispute only to the original submitter and changes its read version at the deadline', async () => {
    const deadline = new Date('2026-10-16T12:00:00.000Z');
    const old = match({ resultConfirmationDeadlineAt: deadline,
      resultVersions: [{ id: 'result-1', submittedById: 'user-1', homeScore: 2, awayScore: 1, updatedAt: at }] });
    jest.setSystemTime(new Date(deadline.getTime() - 1));
    const before = await harness({ currentMatches: [old] }).service.get('user-1');
    jest.setSystemTime(deadline);
    const after = await harness({ currentMatches: [old] }).service.get('user-1');
    const other = await harness({ currentMatches: [match({ resultConfirmationDeadlineAt: deadline })] }).service.get('user-1');

    expect(before.items[0]).toMatchObject({ section: 'STATUS_UPDATE', title: '等待对手确认比分' });
    expect(after.items[0]).toMatchObject({ section: 'ACTION_REQUIRED', title: '上传截图并申请仲裁' });
    expect(after.items[0]!.version).not.toBe(before.items[0]!.version);
    expect(other.items[0]).not.toMatchObject({ section: 'ACTION_REQUIRED', title: '上传截图并申请仲裁' });
  });

  it('uses one request clock for matches near a confirmation deadline', async () => {
    const deadline = new Date('2026-10-16T12:00:00.000Z');
    const first = match({ id: 'first', resultConfirmationDeadlineAt: deadline });
    const second = match({ id: 'second', resultConfirmationDeadlineAt: deadline });
    jest.spyOn(Date, 'now').mockReturnValueOnce(deadline.getTime() - 1).mockReturnValue(deadline.getTime());

    const result = await harness({ currentMatches: [first, second] }).service.get('user-1');

    expect(result.items.map(({ section }) => section)).toEqual(['ACTION_REQUIRED', 'ACTION_REQUIRED']);
  });

  it('counts only my missing evidence and treats supplied evidence or review as status updates', async () => {
    const dispute = (status: string, evidence: any[]) => ({ id: 'dispute-1', status,
      updatedAt: at, evidenceDeadlineAt: new Date('2099-01-01T00:00:00.000Z'),
      triggerResultVersion: { submittedById: 'user-2' }, evidence });
    const missing = await harness({ currentMatches: [match({ status: 'DISPUTED', resultVersions: [], resultDisputes: [dispute('EVIDENCE_COLLECTION', [{ role: 'SUBMITTER', status: 'ACTIVE', updatedAt: at }])] })] }).service.get('user-1');
    const supplied = await harness({ currentMatches: [match({ status: 'DISPUTED', resultVersions: [], resultDisputes: [dispute('EVIDENCE_COLLECTION', [{ role: 'OPPONENT', status: 'ACTIVE', updatedAt: at }])] })] }).service.get('user-1');
    const review = await harness({ currentMatches: [match({ status: 'DISPUTED', resultVersions: [], resultDisputes: [dispute('READY_FOR_REVIEW', [])] })] }).service.get('user-1');

    expect(missing.items[0]).toMatchObject({ section: 'ACTION_REQUIRED', title: '上传截图补充证据' });
    expect(supplied.items[0]).toMatchObject({ section: 'STATUS_UPDATE' });
    expect(review.items[0]).toMatchObject({ section: 'STATUS_UPDATE', title: '等待管理员裁决' });
    expect([missing.actionRequiredCount, supplied.actionRequiredCount, review.actionRequiredCount]).toEqual([1, 0, 0]);
  });

  it('does not count replacement-pending evidence and stops prompting at the evidence deadline', async () => {
    const deadline = new Date('2026-10-16T12:00:00.000Z');
    const evidence = [{ role: 'SUBMITTER', status: 'PENDING_DELETE', updatedAt: at }];
    const disputed = match({ status: 'DISPUTED', resultVersions: [], resultDisputes: [{
      status: 'EVIDENCE_COLLECTION', evidenceDeadlineAt: deadline, updatedAt: at,
      decisionReason: null, triggerResultVersion: { submittedById: 'user-1' }, evidence,
    }] });
    jest.setSystemTime(new Date(deadline.getTime() - 1));
    const before = await harness({ currentMatches: [disputed] }).service.get('user-1');
    jest.setSystemTime(deadline);
    const atDeadline = await harness({ currentMatches: [disputed] }).service.get('user-1');

    expect(before.items[0]).toMatchObject({ section: 'ACTION_REQUIRED', title: '上传截图补充证据' });
    expect(atDeadline.items[0]).toMatchObject({ section: 'STATUS_UPDATE', title: '等待管理员裁决' });
    expect(atDeadline.actionRequiredCount).toBe(0);
    expect(atDeadline.items[0]!.version).not.toBe(before.items[0]!.version);
  });

  it('shows a recent official outcome without evidence details and excludes ineligible matches', async () => {
    const official = match({ id: 'decided', status: 'ADMIN_DECIDED', resultVersions: [],
      officialResultVersion: { homeScore: 3, awayScore: 1, reason: '赛后判定', updatedAt: at },
      resultDisputes: [{ id: 'dispute-1', status: 'RESOLVED', decisionReason: '赛后判定', updatedAt: at, evidence: [{ role: 'OPPONENT', objectKey: 'private-key' }] }] });
    const { service, prisma } = harness({ recentMatches: [official] });
    const result = await service.get('user-1');

    expect(result.items[0]).toMatchObject({ section: 'RECENT', statusLabel: '已裁决', detail: expect.stringContaining('3:1') });
    expect(JSON.stringify(result)).not.toContain('private-key');
    expect(prisma.competitionMatch.findMany.mock.calls[0][0].select.resultDisputes.select).not.toHaveProperty('decisionReason');
    expect(prisma.competitionMatch.findMany.mock.calls[0][0]).toMatchObject({ where: { stage: { status: 'PUBLISHED', competition: { status: { in: ['IN_PROGRESS', 'COMPLETED'] }, season: { league: { isDeleted: false } } } } } });
    expect(prisma.competitionMatch.findMany.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([
      { homeParticipant: { seasonEntry: { ownerUserId: 'user-1', leagueTeam: { status: 'ACTIVE' } } } },
    ]));
  });

  it('does not cap ongoing result reminders with recent history', async () => {
    const old = match({ id: 'old', updatedAt: new Date('2020-01-01T00:00:00.000Z') });
    const { service, prisma } = harness({ currentMatches: [old], recentMatches: [] });
    const result = await service.get('user-1');

    expect(result.items).toEqual([expect.objectContaining({ id: 'match-result:old' })]);
    expect(prisma.competitionMatch.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.competitionMatch.findMany.mock.calls[0][0]).not.toHaveProperty('take');
    expect(prisma.competitionMatch.findMany.mock.calls[1][0]).toMatchObject({ take: 100 });
  });

  it('places a resolved dispute with an official score in recent history', async () => {
    const resolved = match({ status: 'DISPUTED', resultVersions: [],
      officialResultVersion: { homeScore: 1, awayScore: 0, reason: '有效比分', updatedAt: at },
      resultDisputes: [{ id: 'dispute-1', status: 'RESOLVED', decisionReason: '有效比分',
        updatedAt: new Date('2026-10-15T13:00:00.000Z'), evidenceDeadlineAt: at,
        triggerResultVersion: { submittedById: 'user-2' }, evidence: [] }] });
    const result = await harness({ currentMatches: [resolved] }).service.get('user-1');

    expect(result.items[0]).toMatchObject({ section: 'RECENT', statusLabel: '已裁决', detail: expect.stringContaining('1:0') });
    expect(result.items[0]!.version).toBe('2026-10-15T13:00:00.000Z');
    expect(result.actionRequiredCount).toBe(0);
  });

  it.each([
    'cloud://bucket/match-result-evidence--private',
    'match-result-evidence--private-local-key',
    'custom://opaque-object',
    'match-result-evidence--another-key',
  ])('omits a storage-like official reason from the recent card: %s', async (reason) => {
    const official = match({ status: 'ADMIN_DECIDED', resultVersions: [],
      officialResultVersion: { homeScore: 3, awayScore: 1, reason, updatedAt: at } });
    const result = await harness({ recentMatches: [official] }).service.get('user-1');

    expect(result.items[0]).toMatchObject({ section: 'RECENT', detail: '申花 对 海港 · 3:1' });
  });

  it('uses only the current official version reason after a later administrative correction', async () => {
    const corrected = match({ status: 'ADMIN_DECIDED', resultVersions: [],
      officialResultVersion: { homeScore: 0, awayScore: 2, reason: '更正为客胜', updatedAt: new Date('2026-10-15T14:00:00.000Z') },
      resultDisputes: [{ status: 'RESOLVED', decisionReason: '原裁决主胜', updatedAt: at,
        evidenceDeadlineAt: at, triggerResultVersion: { submittedById: 'user-1' }, evidence: [] }] });
    const result = await harness({ recentMatches: [corrected] }).service.get('user-1');

    expect(result.items[0]).toMatchObject({ detail: '申花 对 海港 · 0:2 · 更正为客胜' });
  });

  it('deduplicates a match seen pending then completed across concurrent query snapshots', async () => {
    const pending = match({ id: 'raced' });
    const completed = match({ id: 'raced', status: 'ADMIN_DECIDED', resultVersions: [],
      officialResultVersion: { homeScore: 2, awayScore: 0, reason: '最终裁决', updatedAt: new Date('2026-10-15T13:00:00.000Z') } });
    const result = await harness({ currentMatches: [pending], recentMatches: [completed] }).service.get('user-1');

    expect(result.items).toEqual([expect.objectContaining({ id: 'match-result:raced', section: 'RECENT', detail: expect.stringContaining('2:0') })]);
    expect(result.actionRequiredCount).toBe(0);
  });
});
