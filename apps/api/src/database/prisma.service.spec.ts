import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from './prisma.service.js';

config({ path: '../../.env', quiet: true });

describe('PrismaService', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists and removes a user through the MySQL schema', async () => {
    const openId = `test-openid-${randomUUID()}`;
    const created = await prisma.user.create({
      data: {
        wechatOpenId: openId,
        displayName: '数据库测试玩家'
      }
    });

    expect(created.wechatOpenId).toBe(openId);
    await prisma.user.delete({ where: { id: created.id } });
    await expect(prisma.user.findUnique({ where: { id: created.id } })).resolves.toBeNull();
  });

  it('exposes player catalog and import delegates', () => {
    expect(prisma.dataSource).toBeDefined();
    expect(prisma.playerCard).toBeDefined();
    expect(prisma.importBatch).toBeDefined();
    expect(prisma.catalogRelease).toBeDefined();
  });

  it('exposes external synchronization delegates', () => {
    expect(prisma.externalSyncRun).toBeDefined();
    expect(prisma.externalSyncItem).toBeDefined();
    expect(prisma.externalSyncRunBatch).toBeDefined();
  });

  it('exposes competition aggregate and idempotency delegates', () => {
    expect(prisma.competition).toBeDefined();
    expect(prisma.competitionRuleVersion).toBeDefined();
    expect(prisma.competitionRegistration).toBeDefined();
    expect(prisma.competitionRegistrationStatusHistory).toBeDefined();
    expect(prisma.competitionParticipant).toBeDefined();
    expect(prisma.competitionStage).toBeDefined();
    expect(prisma.competitionMatch).toBeDefined();
    expect(prisma.matchResultVersion).toBeDefined();
    expect(prisma.standingsSnapshot).toBeDefined();
    expect(prisma.standingsRow).toBeDefined();
    expect(prisma.mutationReceipt).toBeDefined();
  });

  it('exposes administrator, league-team, audit, and public-number delegates', () => {
    expect(prisma.adminAccount).toBeDefined();
    expect(prisma.adminSession).toBeDefined();
    expect(prisma.adminLeagueRole).toBeDefined();
    expect(prisma.leagueTeam).toBeDefined();
    expect(prisma.auditLog).toBeDefined();
    expect(prisma.publicUserNumberSequence).toBeDefined();
  });

  it('enforces league-scoped team ownership and numbering while preserving public user numbers', async () => {
    const suffix = randomUUID();
    const owner = await prisma.user.create({
      data: {
        wechatOpenId: `team-owner-${suffix}`,
        publicUserNo: '800001',
        displayName: '联赛球队测试玩家'
      }
    });
    const secondOwner = await prisma.user.create({
      data: {
        wechatOpenId: `team-owner-two-${suffix}`,
        publicUserNo: '800002',
        displayName: '第二位测试玩家'
      }
    });
    const firstLeague = await prisma.league.create({
      data: {
        name: `第一测试联赛-${suffix}`,
        shortName: '第一联赛',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: owner.id
      }
    });
    const secondLeague = await prisma.league.create({
      data: {
        name: `第二测试联赛-${suffix}`,
        shortName: '第二联赛',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: owner.id
      }
    });

    try {
      await prisma.leagueTeam.create({
        data: {
          leagueId: firstLeague.id,
          ownerUserId: owner.id,
          teamNumber: 0,
          name: '第一联赛球队',
          shortName: '一队'
        }
      });

      await expect(prisma.leagueTeam.create({
        data: {
          leagueId: firstLeague.id,
          ownerUserId: owner.id,
          teamNumber: 1,
          name: '重复用户球队',
          shortName: '重复用户'
        }
      })).rejects.toMatchObject({ code: 'P2002' });

      await expect(prisma.leagueTeam.create({
        data: {
          leagueId: firstLeague.id,
          ownerUserId: secondOwner.id,
          teamNumber: 0,
          name: '重复编号球队',
          shortName: '重复编号'
        }
      })).rejects.toMatchObject({ code: 'P2002' });

      await expect(prisma.leagueTeam.create({
        data: {
          leagueId: secondLeague.id,
          ownerUserId: owner.id,
          teamNumber: 0,
          name: '第二联赛球队',
          shortName: '二队'
        }
      })).resolves.toMatchObject({ ownerUserId: owner.id, teamNumber: 0 });

      await expect(prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
        .resolves.toMatchObject({ publicUserNo: '800001' });
      await expect(prisma.user.create({
        data: {
          wechatOpenId: `duplicate-public-number-${suffix}`,
          publicUserNo: '800001',
          displayName: '重复编号玩家'
        }
      })).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await prisma.leagueTeam.deleteMany({
        where: { leagueId: { in: [firstLeague.id, secondLeague.id] } }
      });
      await prisma.league.deleteMany({
        where: { id: { in: [firstLeague.id, secondLeague.id] } }
      });
      await prisma.user.deleteMany({ where: { id: { in: [owner.id, secondOwner.id] } } });
    }
  });

  it('persists required league edition and current season', async () => {
    const suffix = randomUUID();
    const creator = await prisma.user.create({
      data: { wechatOpenId: `league-edition-${suffix}`, displayName: '联赛版本测试' }
    });
    const national = await prisma.league.create({
      data: {
        name: `国服联赛-${suffix}`,
        shortName: '国服联赛',
        edition: 'NATIONAL',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdById: creator.id
      }
    });
    const international = await prisma.league.create({
      data: {
        name: `国际服联赛-${suffix}`,
        shortName: '国际服',
        edition: 'INTERNATIONAL',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: creator.id
      }
    });
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId: national.id,
        seasonNumber: 1,
        displayName: 'S1 赛季',
        isFirstSeason: true,
        registrationOpensAt: new Date('2026-01-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-01-02T00:00:00.000Z'),
        startsAt: new Date('2026-01-03T00:00:00.000Z'),
        endsAt: new Date('2026-02-03T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        createdById: creator.id
      }
    });

    try {
      await prisma.league.update({
        where: { id: national.id },
        data: { currentSeasonId: season.id }
      });
      await expect(prisma.league.findUniqueOrThrow({
        where: { id: national.id },
        include: { currentSeason: true }
      })).resolves.toMatchObject({
        edition: 'NATIONAL',
        currentSeasonId: season.id,
        currentSeason: { id: season.id, leagueId: national.id }
      });
      await expect(prisma.league.findUniqueOrThrow({ where: { id: international.id } }))
        .resolves.toMatchObject({ edition: 'INTERNATIONAL', currentSeasonId: null });
    } finally {
      await prisma.league.update({ where: { id: national.id }, data: { currentSeasonId: null } });
      await prisma.leagueSeason.delete({ where: { id: season.id } });
      await prisma.league.deleteMany({ where: { id: { in: [national.id, international.id] } } });
      await prisma.user.delete({ where: { id: creator.id } });
    }
  });

  it('allows an admin-created league season', async () => {
    const suffix = randomUUID();
    const admin = await prisma.adminAccount.create({
      data: {
        username: `season-admin-${suffix}`,
        displayName: '赛季管理员',
        passwordHash: 'not-used-in-this-test',
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    const league = await prisma.league.create({
      data: {
        name: `后台赛季联赛-${suffix}`,
        shortName: '后台赛季',
        edition: 'INTERNATIONAL',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdByAdminId: admin.id
      }
    });
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId: league.id,
        seasonNumber: 1,
        displayName: '后台 S1',
        isFirstSeason: true,
        registrationOpensAt: new Date('2026-03-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-03-02T00:00:00.000Z'),
        startsAt: new Date('2026-03-03T00:00:00.000Z'),
        endsAt: new Date('2026-04-03T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        createdByAdminId: admin.id
      }
    });

    try {
      await expect(prisma.leagueSeason.findUniqueOrThrow({ where: { id: season.id } }))
        .resolves.toMatchObject({ createdById: null, createdByAdminId: admin.id });
    } finally {
      await prisma.leagueSeason.delete({ where: { id: season.id } });
      await prisma.league.delete({ where: { id: league.id } });
      await prisma.adminAccount.delete({ where: { id: admin.id } });
    }
  });

  it('allows a season entry without a game account', async () => {
    const suffix = randomUUID();
    const owner = await prisma.user.create({
      data: { wechatOpenId: `entry-owner-${suffix}`, displayName: '免账号参赛用户' }
    });
    const league = await prisma.league.create({
      data: {
        name: `免账号联赛-${suffix}`,
        shortName: '免账号',
        edition: 'NATIONAL',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdById: owner.id
      }
    });
    const team = await prisma.leagueTeam.create({
      data: {
        leagueId: league.id,
        ownerUserId: owner.id,
        teamNumber: 1,
        name: '免账号球队',
        shortName: '免账号'
      }
    });
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId: league.id,
        seasonNumber: 1,
        displayName: '免账号 S1',
        isFirstSeason: true,
        registrationOpensAt: new Date('2026-05-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-05-02T00:00:00.000Z'),
        startsAt: new Date('2026-05-03T00:00:00.000Z'),
        endsAt: new Date('2026-06-03T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        createdById: owner.id
      }
    });

    try {
      const entry = await prisma.seasonEntry.create({
        data: {
          seasonId: season.id,
          leagueTeamId: team.id,
          ownerUserId: owner.id,
          source: 'NEW_APPLICATION',
          status: 'APPROVED',
          teamNameSnapshot: team.name,
          teamShortNameSnapshot: team.shortName,
          teamNumberSnapshot: team.teamNumber,
          teamLogoUrlSnapshot: team.logoUrl,
          leagueEditionSnapshot: 'NATIONAL',
          confirmedAt: new Date()
        }
      });
      expect(entry).toMatchObject({
        gameAccountId: null,
        gamePlatformSnapshot: null,
        serverRegionSnapshot: null,
        gamerTagSnapshot: null,
        leagueEditionSnapshot: 'NATIONAL'
      });
    } finally {
      await prisma.seasonEntry.deleteMany({ where: { seasonId: season.id } });
      await prisma.leagueSeason.delete({ where: { id: season.id } });
      await prisma.leagueTeam.delete({ where: { id: team.id } });
      await prisma.league.delete({ where: { id: league.id } });
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });
});
