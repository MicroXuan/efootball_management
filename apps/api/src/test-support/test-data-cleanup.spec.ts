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
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: [testLeagueId, realLeagueId] } } });
    await prisma.league.deleteMany({ where: { id: { in: [testLeagueId, realLeagueId] } } });
    await prisma.playerCard.deleteMany({ where: { sourceId: testSourceId } });
    await prisma.footballPlayerSource.deleteMany({ where: { sourceId: testSourceId } });
    await prisma.footballPlayer.deleteMany({ where: { id: testPlayerId } });
    await prisma.dataSource.deleteMany({ where: { id: { in: [testSourceId, realSourceId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [testUserId, realUserId] } } });
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

    await expect(prisma.dataSource.findUnique({ where: { id: realSourceId } })).resolves.not.toBeNull();
    await expect(prisma.league.findUnique({ where: { id: realLeagueId } })).resolves.not.toBeNull();
    await expect(prisma.user.findUnique({ where: { id: realUserId } })).resolves.not.toBeNull();
  }, 30_000);
});
