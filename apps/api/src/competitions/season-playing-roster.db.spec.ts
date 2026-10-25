import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { SeasonPlayingRosterService } from './season-playing-roster.service.js';

describe('season playing roster database snapshot', () => {
  const prisma = new PrismaService();
  const rollback = new Error('ROLLBACK_PLAYING_ROSTER_FIXTURE');
  let seasonId: string | undefined;

  beforeAll(async () => prisma.$connect());
  afterAll(async () => prisma.$disconnect());

  it('keeps current-season eligibility after a transfer and release, then uses the buyer next season', async () => {
    try {
      await prisma.$transaction(async (tx) => {
        const admin = await tx.adminAccount.create({ data: {
          username: `playing-roster-${randomUUID()}`, displayName: '测试管理员', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
        } });
        const users = await Promise.all([1, 2].map((number) => tx.user.create({ data: {
          wechatOpenId: `playing-roster-${number}-${randomUUID()}`, displayName: `测试玩家${number}`
        } })));
        const league = await tx.league.create({ data: {
          name: `名单快照测试-${randomUUID()}`, shortName: '名单快照测试', defaultPlatform: 'MOBILE',
          defaultServerRegion: 'GLOBAL', createdByAdminId: admin.id
        } });
        const shells = await Promise.all([1, 2].map((number) => tx.teamCatalogItem.create({ data: {
          sourceType: 'CUSTOM', nameZh: `测试球队${number}`, shortName: `测试球队${number}`
        } })));
        const teams = await Promise.all(shells.map((shell, index) => tx.leagueTeam.create({ data: {
          leagueId: league.id, ownerUserId: users[index]!.id, ownerAlias: `玩家${index + 1}`,
          catalogTeamId: shell.id, teamNumber: index + 1, name: `球队${index + 1}`, shortName: `球队${index + 1}`
        } })));
        const seasonData = {
          leagueId: league.id, displayName: 'S1', registrationOpensAt: new Date('2026-09-01T00:00:00.000Z'),
          registrationClosesAt: new Date('2026-09-08T00:00:00.000Z'), startsAt: new Date('2026-09-09T00:00:00.000Z'),
          endsAt: new Date('2026-10-09T00:00:00.000Z'), superCapacity: 23, championCapacity: 18,
          promotionCount: 4, createdByAdminId: admin.id
        };
        const seasonOne = await tx.leagueSeason.create({ data: { ...seasonData, seasonNumber: 1, isFirstSeason: true } });
        seasonId = seasonOne.id;
        const seasonTwo = await tx.leagueSeason.create({ data: {
          ...seasonData, seasonNumber: 2, displayName: 'S2', previousSeasonId: seasonOne.id,
          registrationOpensAt: new Date('2026-10-10T00:00:00.000Z'), registrationClosesAt: new Date('2026-10-17T00:00:00.000Z'),
          startsAt: new Date('2026-10-18T00:00:00.000Z'), endsAt: new Date('2026-11-18T00:00:00.000Z')
        } });
        for (const [season, team, user] of [[seasonOne, teams[0]!, users[0]!], [seasonTwo, teams[1]!, users[1]!]] as const) {
          await tx.seasonEntry.create({ data: {
            seasonId: season.id, leagueTeamId: team.id, ownerUserId: user.id, source: 'NEW_APPLICATION', status: 'APPROVED',
            teamNameSnapshot: team.name, teamShortNameSnapshot: team.shortName
          } });
        }
        const source = await tx.dataSource.create({ data: { code: `roster-${randomUUID()}`, name: '名单快照测试' } });
        const player = await tx.footballPlayer.create({ data: { nameZh: '测试球员' } });
        const card = await tx.playerCard.create({ data: {
          sourceId: source.id, externalId: `roster-${randomUUID()}`, playerId: player.id,
          cardName: '测试卡', position: 'CF', overallRating: 90, cardType: 'STANDARD'
        } });
        const salaryRule = await tx.leagueSalaryRuleVersion.create({ data: {
          leagueId: league.id, version: 1, salaryCapMinor: 10000,
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'), createdByAdminId: admin.id
        } });
        const ownership = await tx.leaguePlayerOwnership.create({ data: {
          leagueId: league.id, leagueTeamId: teams[0]!.id, footballPlayerId: player.id,
          currentPlayerCardId: card.id, maxOverallSnapshot: 90, salaryRuleVersionId: salaryRule.id, salaryMinor: 100
        } });
        const roster = new SeasonPlayingRosterService(tx as never);

        await roster.capture(tx, seasonOne.id);
        await tx.leaguePlayerOwnership.update({ where: { id: ownership.id }, data: { leagueTeamId: teams[1]!.id } });
        expect((await roster.list(users[0]!.id, seasonOne.id)).items[0]?.leagueTeamId).toBe(teams[0]!.id);

        await roster.capture(tx, seasonTwo.id);
        expect((await roster.list(users[1]!.id, seasonTwo.id)).items[0]?.leagueTeamId).toBe(teams[1]!.id);

        await tx.leaguePlayerOwnership.update({ where: { id: ownership.id }, data: { status: 'RELEASED' } });
        expect((await roster.list(users[0]!.id, seasonOne.id)).items).toHaveLength(1);
        expect((await roster.list(users[1]!.id, seasonTwo.id)).items).toHaveLength(1);
        throw rollback;
      }, { timeout: 20_000 });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(seasonId).toBeDefined();
    expect(await prisma.leagueSeason.findUnique({ where: { id: seasonId! } })).toBeNull();
  });
});
