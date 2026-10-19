import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { cleanupKnownTestArtifacts } from '../../test/helpers/test-data-cleanup.js';

config({ path: '../../.env', quiet: true });

describe('known integration-test artifact cleanup', () => {
  const prisma = new PrismaService();
  const suffix = randomUUID();
  const testUserId = randomUUID();
  const realUserId = randomUUID();
  const testAdminId = randomUUID();
  const realAdminId = randomUUID();
  const platformE2eAdminId = randomUUID();
  const managerE2eAdminId = randomUUID();
  const platformE2eUserId = randomUUID();
  const platformE2eLeagueIds = [randomUUID(), randomUUID()];
  let testSourceId = '';
  let testPlayerId = '';
  let testLeagueId = '';
  let realSourceId = '';
  let realLeagueId = '';

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({ data: [
      { id: testUserId, wechatOpenId: `dispute-${suffix}`, displayName: '争议测试' },
      { id: realUserId, wechatOpenId: `real-cleanup-${suffix}`, displayName: '真实用户' }
    ] });
    await prisma.adminAccount.createMany({ data: [
      {
        id: testAdminId,
        username: `roster-${suffix}`,
        displayName: 'Roster Admin',
        passwordHash: 'test',
        platformRole: 'PLATFORM_ADMIN'
      },
      {
        id: realAdminId,
        username: `real-roster-${suffix}`,
        displayName: 'Roster Admin',
        passwordHash: 'test',
        platformRole: 'PLATFORM_ADMIN'
      },
      {
        id: platformE2eAdminId,
        username: `platform-${suffix}`,
        displayName: '平台管理员',
        passwordHash: 'test',
        platformRole: 'PLATFORM_ADMIN'
      },
      {
        id: managerE2eAdminId,
        username: `manager-${suffix}`,
        displayName: '联赛管理员',
        passwordHash: 'test',
        platformRole: 'LEAGUE_MANAGER'
      }
    ] });
    await prisma.user.create({
      data: {
        id: platformE2eUserId,
        wechatOpenId: `openid-${suffix}`,
        displayName: '六位编号用户'
      }
    });
    await prisma.league.createMany({ data: platformE2eLeagueIds.map((id, index) => ({
      id,
      name: `测试联赛 ${index === 0 ? 'A' : 'B'}`,
      shortName: `联赛${index === 0 ? 'A' : 'B'}`,
      defaultPlatform: 'MOBILE' as const,
      defaultServerRegion: 'GLOBAL',
      createdByAdminId: platformE2eAdminId
    })) });
    await prisma.adminLeagueRole.createMany({ data: platformE2eLeagueIds.map((leagueId) => ({
      adminId: managerE2eAdminId,
      leagueId,
      grantedById: platformE2eAdminId
    })) });
    await prisma.auditLog.createMany({ data: platformE2eLeagueIds.map((leagueId) => ({
      actorAdminId: platformE2eAdminId,
      leagueId,
      action: 'admin.league.create',
      resourceType: 'League',
      resourceId: leagueId,
      metadata: {}
    })) });
    await prisma.adminMutationReceipt.create({ data: {
      adminId: platformE2eAdminId,
      operation: `admin.league.create:${platformE2eLeagueIds[0]}`,
      key: suffix
    } });

    const testSource = await prisma.dataSource.create({
      data: { code: `publisher-${suffix}`, name: 'Publisher test' }
    });
    testSourceId = testSource.id;
    const testPlayer = await prisma.footballPlayer.create({
      data: { nameZh: `发布测试 ${suffix}`, nameEn: `Publisher Test ${suffix}` }
    });
    testPlayerId = testPlayer.id;
    await prisma.footballPlayerSource.create({
      data: { sourceId: testSource.id, playerId: testPlayer.id, externalId: `player-${suffix}` }
    });
    await prisma.playerCard.create({ data: {
      sourceId: testSource.id,
      playerId: testPlayer.id,
      externalId: suffix,
      cardName: 'Featured',
      position: 'CMF',
      overallRating: 95,
      cardType: 'FEATURED'
    } });

    const testLeague = await prisma.league.create({ data: {
      name: '仲裁', shortName: '仲裁', defaultPlatform: 'MOBILE',
      defaultServerRegion: 'GLOBAL', createdById: testUserId
    } });
    testLeagueId = testLeague.id;
    await prisma.leagueSeason.create({ data: {
      leagueId: testLeague.id, seasonNumber: 1, displayName: 'S1', isFirstSeason: true,
      registrationOpensAt: new Date('2026-01-01'), registrationClosesAt: new Date('2026-01-02'),
      startsAt: new Date('2026-01-03'), endsAt: new Date('2027-01-01'),
      superCapacity: 2, championCapacity: 2, promotionCount: 1,
      createdById: testUserId
    } });

    realSourceId = (await prisma.dataSource.create({
      data: { code: `real-cleanup-${suffix}`, name: 'Real cleanup fixture' }
    })).id;
    realLeagueId = (await prisma.league.create({ data: {
      name: '仲裁', shortName: '仲裁', defaultPlatform: 'MOBILE',
      defaultServerRegion: 'GLOBAL', createdById: realUserId
    } })).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { leagueId: { in: platformE2eLeagueIds } },
          { actorAdminId: { in: [platformE2eAdminId, managerE2eAdminId] } }
        ]
      }
    });
    await prisma.adminMutationReceipt.deleteMany({
      where: { adminId: { in: [platformE2eAdminId, managerE2eAdminId] } }
    });
    await prisma.adminLeagueRole.deleteMany({ where: { leagueId: { in: platformE2eLeagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: platformE2eLeagueIds } } });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: [testLeagueId, realLeagueId] } } });
    await prisma.league.deleteMany({ where: { id: { in: [testLeagueId, realLeagueId] } } });
    await prisma.playerCard.deleteMany({ where: { sourceId: testSourceId } });
    await prisma.footballPlayerSource.deleteMany({ where: { sourceId: testSourceId } });
    await prisma.footballPlayer.deleteMany({ where: { id: testPlayerId } });
    await prisma.dataSource.deleteMany({ where: { id: { in: [testSourceId, realSourceId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [testUserId, realUserId] } } });
    await prisma.user.deleteMany({ where: { id: platformE2eUserId } });
    await prisma.adminAccount.deleteMany({
      where: { id: { in: [testAdminId, realAdminId, platformE2eAdminId, managerE2eAdminId] } }
    });
    await prisma.$disconnect();
  });

  it('deletes only records carrying the explicit test markers', async () => {
    const result = await cleanupKnownTestArtifacts(prisma);

    expect(result.publisherSources).toBeGreaterThanOrEqual(1);
    expect(result.arbitrationLeagues).toBeGreaterThanOrEqual(1);
    await expect(prisma.dataSource.findUnique({ where: { id: testSourceId } })).resolves.toBeNull();
    await expect(prisma.footballPlayer.findUnique({ where: { id: testPlayerId } })).resolves.toBeNull();
    await expect(prisma.league.findUnique({ where: { id: testLeagueId } })).resolves.toBeNull();
    await expect(prisma.user.findUnique({ where: { id: testUserId } })).resolves.toBeNull();
    await expect(prisma.adminAccount.findUnique({ where: { id: testAdminId } })).resolves.toBeNull();
    await expect(prisma.league.count({ where: { id: { in: platformE2eLeagueIds } } })).resolves.toBe(0);
    await expect(prisma.adminAccount.findUnique({ where: { id: platformE2eAdminId } })).resolves.toBeNull();
    await expect(prisma.adminAccount.findUnique({ where: { id: managerE2eAdminId } })).resolves.toBeNull();
    await expect(prisma.user.findUnique({ where: { id: platformE2eUserId } })).resolves.toBeNull();

    await expect(prisma.dataSource.findUnique({ where: { id: realSourceId } })).resolves.not.toBeNull();
    await expect(prisma.league.findUnique({ where: { id: realLeagueId } })).resolves.not.toBeNull();
    await expect(prisma.user.findUnique({ where: { id: realUserId } })).resolves.not.toBeNull();
    await expect(prisma.adminAccount.findUnique({ where: { id: realAdminId } })).resolves.not.toBeNull();
  }, 30_000);
});
