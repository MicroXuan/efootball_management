import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from './league-visibility.service.js';

config({ path: '../../.env', quiet: true });

describe('LeagueVisibilityService', () => {
  const prisma = new PrismaService();
  const service = new LeagueVisibilityService(prisma);
  const suffix = randomUUID();
  let leagueId: string;
  let seasonId: string;
  let teamId: string;
  let competitionId: string;
  let standaloneCompetitionId: string;
  let stageId: string;
  let matchId: string;
  let windowId: string;
  let valuationWindowId: string;
  let valuationSubmissionId: string;
  let ownershipId: string;
  let adminId: string;
  let catalogId: string;
  let sourceId: string;
  let playerId: string;
  let cardId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    const users = await Promise.all([1, 2].map((index) => prisma.user.create({
      data: { wechatOpenId: `visibility-${suffix}-${index}`, displayName: `可见性用户${index}` }
    })));
    userIds.push(...users.map(({ id }) => id));
    const admin = await prisma.adminAccount.create({
      data: {
        username: `visibility-${suffix}`,
        displayName: '可见性管理员',
        passwordHash: 'not-used',
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    adminId = admin.id;
    const league = await prisma.league.create({
      data: {
        name: '可见性联赛',
        shortName: '可见性',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: users[0]!.id
      }
    });
    leagueId = league.id;
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId,
        seasonNumber: 1,
        displayName: 'S1',
        isFirstSeason: true,
        registrationOpensAt: new Date('2026-09-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-09-08T00:00:00.000Z'),
        startsAt: new Date('2026-09-09T00:00:00.000Z'),
        endsAt: new Date('2026-10-09T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        createdById: users[0]!.id
      }
    });
    seasonId = season.id;
    const catalog = await prisma.teamCatalogItem.create({
      data: { sourceType: 'CUSTOM', nameZh: '可见性球队', shortName: '可见' }
    });
    catalogId = catalog.id;
    const team = await prisma.leagueTeam.create({
      data: {
        leagueId,
        ownerUserId: users[0]!.id,
        ownerAlias: '可见性用户',
        catalogTeamId: catalog.id,
        teamNumber: 1,
        name: '可见性球队',
        shortName: '可见'
      }
    });
    teamId = team.id;
    const competitionData = {
      description: '',
      platform: 'MOBILE' as const,
      serverRegion: 'GLOBAL',
      participantType: 'INDIVIDUAL' as const,
      format: 'ROUND_ROBIN' as const,
      registrationOpensAt: new Date('2026-09-01T00:00:00.000Z'),
      registrationClosesAt: new Date('2026-09-08T00:00:00.000Z'),
      startsAt: new Date('2026-09-09T00:00:00.000Z'),
      endsAt: new Date('2026-10-09T00:00:00.000Z'),
      participantLimit: 8,
      createdById: users[0]!.id
    };
    const competition = await prisma.competition.create({
      data: { ...competitionData, seasonId, name: '联赛赛事' }
    });
    competitionId = competition.id;
    const standalone = await prisma.competition.create({
      data: { ...competitionData, name: '独立赛事' }
    });
    standaloneCompetitionId = standalone.id;
    const stage = await prisma.competitionStage.create({
      data: { competitionId, sequence: 1, stageCode: 'LEAGUE', displayName: '联赛阶段' }
    });
    stageId = stage.id;
    const participants = await Promise.all(users.map((user, index) => prisma.competitionParticipant.create({
      data: {
        competitionId,
        individualUserId: user.id,
        admissionSequence: index + 1,
        displayNameSnapshot: user.displayName
      }
    })));
    const match = await prisma.competitionMatch.create({
      data: {
        stageId,
        roundNumber: 1,
        pairingKey: 'visibility-pair',
        matchNumber: 1,
        homeParticipantId: participants[0]!.id,
        awayParticipantId: participants[1]!.id
      }
    });
    matchId = match.id;
    const window = await prisma.transferWindow.create({
      data: {
        seasonId,
        name: '窗口',
        startsAt: new Date('2026-09-01T00:00:00.000Z'),
        endsAt: new Date('2026-09-30T00:00:00.000Z'),
        allowBuy: true,
        allowSell: true,
        allowTransfer: true,
        allowCardUpgrade: true,
        createdByAdminId: adminId
      }
    });
    windowId = window.id;
    const valuationWindow = await prisma.valuationWindow.create({
      data: {
        seasonId,
        name: '身价窗口',
        startsAt: new Date('2026-09-01T00:00:00.000Z'),
        endsAt: new Date('2026-09-30T00:00:00.000Z'),
        createdByAdminId: adminId
      }
    });
    valuationWindowId = valuationWindow.id;
    const valuationRule = await prisma.valuationWindowRuleVersion.create({
      data: {
        windowId: valuationWindowId,
        version: 1,
        minimumValueMinor: 100,
        maximumValueMinor: 10_000,
        maximumIncreaseBps: 2_000,
        maximumDecreaseBps: 2_000,
        createdByAdminId: adminId
      }
    });
    await prisma.valuationWindow.update({
      where: { id: valuationWindowId },
      data: { currentRuleVersionId: valuationRule.id }
    });
    const valuationSubmission = await prisma.valuationSubmission.create({
      data: {
        windowId: valuationWindowId,
        leagueTeamId: teamId,
        ruleVersionId: valuationRule.id,
        attemptNumber: 1,
        submittedByUserId: users[0]!.id
      }
    });
    valuationSubmissionId = valuationSubmission.id;
    const source = await prisma.dataSource.create({
      data: { code: `visibility-${suffix}`, name: '可见性来源' }
    });
    sourceId = source.id;
    const player = await prisma.footballPlayer.create({ data: { nameZh: '可见性球员' } });
    playerId = player.id;
    const card = await prisma.playerCard.create({
      data: {
        sourceId,
        externalId: `visibility-${suffix}`,
        playerId,
        cardName: '可见性卡片',
        position: 'CF',
        overallRating: 80,
        cardType: 'STANDARD'
      }
    });
    cardId = card.id;
    const salaryRule = await prisma.leagueSalaryRuleVersion.create({
      data: {
        leagueId,
        version: 1,
        salaryCapMinor: 10_000,
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
        createdByAdminId: adminId
      }
    });
    const ownership = await prisma.leaguePlayerOwnership.create({
      data: {
        leagueId,
        leagueTeamId: teamId,
        footballPlayerId: playerId,
        currentPlayerCardId: cardId,
        maxOverallSnapshot: 80,
        salaryRuleVersionId: salaryRule.id,
        salaryMinor: 100
      }
    });
    ownershipId = ownership.id;
  });

  afterAll(async () => {
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: false } });
    await prisma.leaguePlayerOwnership.delete({ where: { id: ownershipId } });
    await prisma.leagueSalaryRuleVersion.deleteMany({ where: { leagueId } });
    await prisma.valuationSubmission.delete({ where: { id: valuationSubmissionId } });
    await prisma.valuationWindow.update({
      where: { id: valuationWindowId },
      data: { currentRuleVersionId: null }
    });
    await prisma.valuationWindowRuleVersion.deleteMany({ where: { windowId: valuationWindowId } });
    await prisma.valuationWindow.delete({ where: { id: valuationWindowId } });
    await prisma.transferWindow.delete({ where: { id: windowId } });
    await prisma.competitionMatch.delete({ where: { id: matchId } });
    await prisma.competitionParticipant.deleteMany({ where: { competitionId } });
    await prisma.competitionStage.delete({ where: { id: stageId } });
    await prisma.competition.deleteMany({ where: { id: { in: [competitionId, standaloneCompetitionId] } } });
    await prisma.leagueTeam.delete({ where: { id: teamId } });
    await prisma.teamCatalogItem.delete({ where: { id: catalogId } });
    await prisma.leagueSeason.delete({ where: { id: seasonId } });
    await prisma.league.delete({ where: { id: leagueId } });
    await prisma.playerCard.delete({ where: { id: cardId } });
    await prisma.footballPlayer.delete({ where: { id: playerId } });
    await prisma.dataSource.delete({ where: { id: sourceId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it.each([
    ['LEAGUE', () => leagueId],
    ['SEASON', () => seasonId],
    ['TEAM', () => teamId],
    ['COMPETITION', () => competitionId],
    ['STAGE', () => stageId],
    ['MATCH', () => matchId],
    ['TRANSFER_WINDOW', () => windowId],
    ['VALUATION_WINDOW', () => valuationWindowId],
    ['VALUATION_SUBMISSION', () => valuationSubmissionId],
    ['OWNERSHIP', () => ownershipId]
  ] as const)('resolves a visible %s resource to its league', async (type, id) => {
    await expect(service.requireVisible({ type, id: id() })).resolves.toBe(leagueId);
  });

  it('allows a valid standalone competition without assigning a league', async () => {
    await expect(service.requireVisible({
      type: 'COMPETITION',
      id: standaloneCompetitionId
    })).resolves.toBeNull();
  });

  it('uses the same not-found response for missing and deleted resources', async () => {
    const expected = { status: 404, response: { code: 'LEAGUE_NOT_FOUND', message: 'League was not found' } };
    await expect(service.requireVisible({ type: 'LEAGUE', id: randomUUID() })).rejects.toMatchObject(expected);

    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: true } });
    await expect(service.requireVisible({ type: 'LEAGUE', id: leagueId })).rejects.toMatchObject(expected);
    await expect(service.requireVisible({ type: 'MATCH', id: matchId })).rejects.toMatchObject(expected);
    await expect(service.requireVisible({ type: 'VALUATION_WINDOW', id: valuationWindowId })).rejects.toMatchObject(expected);
    await expect(service.requireVisible({ type: 'VALUATION_SUBMISSION', id: valuationSubmissionId })).rejects.toMatchObject(expected);
  });
});
