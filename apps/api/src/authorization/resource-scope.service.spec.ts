import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { ResourceScopeService } from './resource-scope.service.js';

config({ path: '../../.env', quiet: true });

describe('ResourceScopeService', () => {
  const prisma = new PrismaService();
  const visibility = new LeagueVisibilityService(prisma);
  const service = new (ResourceScopeService as unknown as new (
    prisma: PrismaService,
    visibility: LeagueVisibilityService
  ) => ResourceScopeService)(prisma, visibility);
  const suffix = randomUUID();
  let userId: string;
  let leagueId: string;
  let seasonId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        wechatOpenId: `resource-scope-${suffix}`,
        displayName: '作用域测试'
      }
    });
    userId = user.id;
    const league = await prisma.league.create({
      data: {
        name: '作用域联赛',
        shortName: '作用域',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: userId
      }
    });
    leagueId = league.id;
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId,
        seasonNumber: 1,
        displayName: 'S1',
        isFirstSeason: true,
        registrationOpensAt: new Date('2026-10-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-10-08T00:00:00.000Z'),
        startsAt: new Date('2026-10-09T00:00:00.000Z'),
        endsAt: new Date('2026-11-09T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        createdById: userId
      }
    });
    seasonId = season.id;
  });

  afterAll(async () => {
    await prisma.leagueSeason.delete({ where: { id: seasonId } });
    await prisma.league.delete({ where: { id: leagueId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('returns only the exact target for a flat resource', async () => {
    const competitionId = randomUUID();

    await expect(service.resolve('COMPETITION', competitionId)).resolves.toEqual({
      exact: { type: 'COMPETITION', id: competitionId },
      ancestors: []
    });
  });

  it('resolves a season with its parent league', async () => {
    await expect(service.resolve('SEASON', seasonId)).resolves.toEqual({
      exact: { type: 'SEASON', id: seasonId },
      ancestors: [{ type: 'LEAGUE', id: leagueId }]
    });
  });

  it('returns undefined for a missing hierarchical resource', async () => {
    await expect(service.resolve('SEASON', randomUUID())).resolves.toBeUndefined();
  });

  it('rejects deleted league and season scopes as not found', async () => {
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: true } });
    const expected = {
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND', message: 'League was not found' }
    };

    await expect(service.resolve('LEAGUE', leagueId)).rejects.toMatchObject(expected);
    await expect(service.resolve('SEASON', seasonId)).rejects.toMatchObject(expected);

    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: false } });
  });
});
