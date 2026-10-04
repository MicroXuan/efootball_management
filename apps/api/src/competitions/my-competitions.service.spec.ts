import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { MyCompetitionsService } from './my-competitions.service.js';

config({ path: '../../.env', quiet: true });

describe('MyCompetitionsService', () => {
  const prisma = new PrismaService();
  const service = new MyCompetitionsService(prisma);
  const userId = randomUUID();
  const opponentId = randomUUID();
  const managerId = randomUUID();
  const competitionIds: string[] = [];
  const accountIds: string[] = [];
  const leagueIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({ data: [
      { id: userId, wechatOpenId: `dashboard-${userId}`, displayName: '我的玩家' },
      { id: opponentId, wechatOpenId: `dashboard-${opponentId}`, displayName: '对手玩家' },
      { id: managerId, wechatOpenId: `dashboard-${managerId}`, displayName: '赛事管理员' }
    ] });
  });

  afterEach(async () => {
    await prisma.standingsRow.deleteMany({ where: { snapshot: { competitionId: { in: competitionIds } } } });
    await prisma.standingsSnapshot.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionMatch.updateMany({ where: { stage: { competitionId: { in: competitionIds } } }, data: { officialResultVersionId: null } });
    await prisma.matchResultVersion.deleteMany({ where: { match: { stage: { competitionId: { in: competitionIds } } } } });
    await prisma.competitionMatch.deleteMany({ where: { stage: { competitionId: { in: competitionIds } } } });
    await prisma.competitionStage.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionParticipant.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionRegistration.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.competitionRuleVersion.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.cupCompetitionConfig.deleteMany({ where: { competitionId: { in: competitionIds } } });
    await prisma.gameAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.competition.deleteMany({ where: { id: { in: competitionIds } } });
    await prisma.seasonEntry.deleteMany({ where: { season: { leagueId: { in: leagueIds } } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    competitionIds.splice(0);
    accountIds.splice(0);
    leagueIds.splice(0);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, opponentId, managerId] } } });
    await prisma.$disconnect();
  });

  async function event(name: string, myStatus: 'PENDING' | 'REJECTED' | 'APPROVED', includeOther = false) {
    const competition = await prisma.competition.create({ data: {
      name, description: '', platform: 'MOBILE', serverRegion: 'GLOBAL', participantType: 'INDIVIDUAL',
      format: 'ROUND_ROBIN', status: 'IN_PROGRESS', registrationOpensAt: new Date('2026-09-01'),
      registrationClosesAt: new Date('2026-09-02'), startsAt: new Date('2026-09-03'), endsAt: new Date('2026-10-01'),
      participantLimit: 8, createdById: managerId, boundRuleVersion: 1
    } });
    competitionIds.push(competition.id);
    await prisma.competitionRuleVersion.create({ data: {
      competitionId: competition.id, version: 1, winPoints: 3, drawPoints: 1, lossPoints: 0,
      tieBreakers: ['TOTAL_POINTS'], createdById: managerId
    } });
    const mine = await prisma.gameAccount.create({ data: {
      userId, platform: 'MOBILE', serverRegion: 'GLOBAL', gamerTag: `Mine-${name}`
    } });
    accountIds.push(mine.id);
    const registration = await prisma.competitionRegistration.create({ data: {
      competitionId: competition.id, applicantId: userId, gameAccountId: mine.id,
      acceptedRuleVersion: 1, status: myStatus
    } });
    let myParticipant = null;
    if (myStatus === 'APPROVED') {
      myParticipant = await prisma.competitionParticipant.create({ data: {
        competitionId: competition.id, registrationId: registration.id, individualUserId: userId,
        admissionSequence: 1, displayNameSnapshot: '我的玩家'
      } });
    }
    if (includeOther) {
      const other = await prisma.gameAccount.create({ data: {
        userId: opponentId, platform: 'MOBILE', serverRegion: 'GLOBAL', gamerTag: `Other-${name}`
      } });
      accountIds.push(other.id);
      const otherRegistration = await prisma.competitionRegistration.create({ data: {
        competitionId: competition.id, applicantId: opponentId, gameAccountId: other.id,
        acceptedRuleVersion: 1, status: 'APPROVED'
      } });
      const opponent = await prisma.competitionParticipant.create({ data: {
        competitionId: competition.id, registrationId: otherRegistration.id, individualUserId: opponentId,
        admissionSequence: 2, displayNameSnapshot: '对手玩家'
      } });
      return { competition, registration, myParticipant: myParticipant!, opponent };
    }
    return { competition, registration, myParticipant };
  }

  it('returns only my pending, rejected, and approved registrations with cursor pages', async () => {
    await event('待审核赛事', 'PENDING');
    await event('被拒赛事', 'REJECTED');
    await event('已通过赛事', 'APPROVED');
    const first = await service.listCompetitions(userId, { limit: 2 });
    const second = await service.listCompetitions(userId, { limit: 2, cursor: first.nextCursor! });
    expect([...first.items, ...second.items].map(({ registration }) => registration.status).sort())
      .toEqual(['APPROVED', 'PENDING', 'REJECTED']);
    expect(new Set([...first.items, ...second.items].map(({ registration }) => registration.id)).size).toBe(3);
  });

  it('derives SUBMIT, WAIT, CONFIRM, and DONE actions without exposing unrelated matches', async () => {
    const { competition, myParticipant, opponent } = await event('动作赛事', 'APPROVED', true);
    const stage = await prisma.competitionStage.create({ data: {
      competitionId: competition.id, sequence: 1, status: 'PUBLISHED', publishedAt: new Date()
    } });
    const createMatch = (matchNumber: number, plannedAt: Date | null, status: 'AWAITING_RESULT' | 'CONFIRMED' = 'AWAITING_RESULT') =>
      prisma.competitionMatch.create({ data: {
        stageId: stage.id, roundNumber: matchNumber, matchNumber, pairingKey: `dashboard-pair-${matchNumber}`,
        homeParticipantId: myParticipant!.id, awayParticipantId: opponent!.id, plannedAt, status
      } });
    const submit = await createMatch(1, new Date('2026-09-26T10:00:00.000Z'));
    const wait = await createMatch(2, new Date('2026-09-27T10:00:00.000Z'));
    const confirm = await createMatch(3, null);
    const done = await createMatch(4, null, 'CONFIRMED');
    await prisma.matchResultVersion.create({ data: {
      matchId: wait.id, version: 1, homeScore: 1, awayScore: 0, submittedById: userId, submissionSide: 'HOME'
    } });
    await prisma.matchResultVersion.create({ data: {
      matchId: confirm.id, version: 1, homeScore: 0, awayScore: 2, submittedById: opponentId, submissionSide: 'AWAY'
    } });

    const page = await service.listMatches(userId, { limit: 10 });
    expect(page.items.map(({ match }) => match.id)).toEqual([submit.id, wait.id, confirm.id, done.id]);
    expect(page.items.map(({ action }) => action)).toEqual(['SUBMIT', 'WAIT', 'CONFIRM', 'DONE']);
    expect(page.items.find(({ action }) => action === 'WAIT')?.actionableResultVersion).toBeNull();
    expect(page.items.find(({ action }) => action === 'CONFIRM')?.actionableResultVersion?.submittedByMe).toBe(false);

    await prisma.competition.update({ where: { id: competition.id }, data: { status: 'SCHEDULED' } });
    const scheduled = await service.listMatches(userId, { limit: 10 });
    expect(scheduled.items.map(({ action }) => action)).toEqual(['WAIT', 'WAIT', 'WAIT', 'DONE']);

    await prisma.competition.update({ where: { id: competition.id }, data: { status: 'CANCELLED' } });
    await expect(service.listMatches(userId, { limit: 10 })).resolves.toMatchObject({ items: [] });
  });

  it('shows a season-team cup registration and its next match in my dashboard', async () => {
    const league = await prisma.league.create({ data: {
      name: '测试杯赛联赛', shortName: '杯赛', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL',
      createdById: managerId
    } });
    leagueIds.push(league.id);
    const season = await prisma.leagueSeason.create({ data: {
      leagueId: league.id, seasonNumber: 1, displayName: 'S1', isFirstSeason: true,
      registrationOpensAt: new Date('2026-08-01'), registrationClosesAt: new Date('2026-08-10'),
      startsAt: new Date('2026-08-11'), endsAt: new Date('2026-12-01'),
      superCapacity: 2, championCapacity: 2, promotionCount: 1, status: 'IN_PROGRESS', createdById: managerId
    } });
    const [myTeam, otherTeam] = await Promise.all([
      prisma.leagueTeam.create({ data: { leagueId: league.id, ownerUserId: userId, name: '上海海港', shortName: '海港' } }),
      prisma.leagueTeam.create({ data: { leagueId: league.id, ownerUserId: opponentId, name: '北京国安', shortName: '国安' } })
    ]);
    const [myEntry, otherEntry] = await Promise.all([
      prisma.seasonEntry.create({ data: {
        seasonId: season.id, leagueTeamId: myTeam.id, ownerUserId: userId, source: 'NEW_APPLICATION', status: 'APPROVED',
        teamNameSnapshot: myTeam.name, teamShortNameSnapshot: myTeam.shortName
      } }),
      prisma.seasonEntry.create({ data: {
        seasonId: season.id, leagueTeamId: otherTeam.id, ownerUserId: opponentId, source: 'NEW_APPLICATION', status: 'APPROVED',
        teamNameSnapshot: otherTeam.name, teamShortNameSnapshot: otherTeam.shortName
      } })
    ]);
    const competition = await prisma.competition.create({ data: {
      seasonId: season.id, name: 'S1 足总杯', description: '', platform: 'MOBILE', serverRegion: 'GLOBAL',
      participantType: 'TEAM', competitionType: 'KNOCKOUT_CUP', format: 'SINGLE_ELIMINATION', status: 'IN_PROGRESS',
      registrationOpensAt: new Date('2026-09-01'), registrationClosesAt: new Date('2026-09-02'),
      startsAt: new Date('2026-09-03'), endsAt: new Date('2026-10-01'), participantLimit: 8,
      createdById: managerId, boundRuleVersion: 1, cupConfig: { create: {} }
    } });
    competitionIds.push(competition.id);
    await prisma.competitionRuleVersion.create({ data: {
      competitionId: competition.id, version: 1, winPoints: 3, drawPoints: 1, lossPoints: 0,
      tieBreakers: ['TOTAL_POINTS'], createdById: managerId
    } });
    const [myRegistration, otherRegistration] = await Promise.all([
      prisma.competitionRegistration.create({ data: {
        competitionId: competition.id, applicantId: userId, seasonEntryId: myEntry.id,
        acceptedRuleVersion: 1, status: 'APPROVED'
      } }),
      prisma.competitionRegistration.create({ data: {
        competitionId: competition.id, applicantId: opponentId, seasonEntryId: otherEntry.id,
        acceptedRuleVersion: 1, status: 'APPROVED'
      } })
    ]);
    const [mine, opponent] = await Promise.all([
      prisma.competitionParticipant.create({ data: {
        competitionId: competition.id, registrationId: myRegistration.id, seasonEntryId: myEntry.id,
        participantType: 'TEAM', admissionSequence: 1, displayNameSnapshot: myEntry.teamNameSnapshot
      } }),
      prisma.competitionParticipant.create({ data: {
        competitionId: competition.id, registrationId: otherRegistration.id, seasonEntryId: otherEntry.id,
        participantType: 'TEAM', admissionSequence: 2, displayNameSnapshot: otherEntry.teamNameSnapshot
      } })
    ]);
    const stage = await prisma.competitionStage.create({ data: {
      competitionId: competition.id, sequence: 1, stageCode: 'FINAL', displayName: '决赛',
      format: 'SINGLE_ELIMINATION', capacity: 2, status: 'PUBLISHED', publishedAt: new Date()
    } });
    await prisma.competitionMatch.create({ data: {
      stageId: stage.id, roundNumber: 1, matchNumber: 1, pairingKey: 'cup-final',
      homeParticipantId: mine.id, awayParticipantId: opponent.id, status: 'AWAITING_RESULT'
    } });

    const competitions = await service.listCompetitions(userId, { limit: 10 });
    expect(competitions.items[0]).toMatchObject({
      competition: { id: competition.id, seasonId: season.id },
      registration: { seasonEntryId: myEntry.id, teamName: '上海海港' }
    });
    const matches = await service.listMatches(userId, { limit: 10 });
    expect(matches.items).toHaveLength(1);
    expect(matches.items[0]).toMatchObject({ myParticipantId: mine.id, action: 'SUBMIT' });
  });
});
