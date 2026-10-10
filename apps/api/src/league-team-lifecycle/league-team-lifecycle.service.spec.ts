import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { LeagueTeamLifecycleService } from './league-team-lifecycle.service.js';

config({ path: '../../.env', quiet: true });

describe('LeagueTeamLifecycleService', () => {
  const prisma = new PrismaService();
  const visibility = new LeagueVisibilityService(prisma);
  const service = new LeagueTeamLifecycleService(prisma, visibility);
  const suffix = randomUUID();
  let userId: string;
  let leagueId: string;
  let catalogId: string;
  let teamId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: { wechatOpenId: `team-lifecycle-${suffix}`, displayName: '生命周期用户' }
    });
    userId = user.id;
    const league = await prisma.league.create({
      data: {
        name: `生命周期联赛-${suffix}`,
        shortName: '生命周期',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: user.id
      }
    });
    leagueId = league.id;
    const catalog = await prisma.teamCatalogItem.create({
      data: { sourceType: 'CUSTOM', nameZh: '生命周期球队', shortName: '生命周期' }
    });
    catalogId = catalog.id;
    const team = await prisma.leagueTeam.create({
      data: {
        leagueId,
        ownerUserId: user.id,
        ownerAlias: '生命周期用户',
        catalogTeamId: catalog.id,
        teamNumber: 1,
        name: '生命周期球队',
        shortName: '生命周期'
      }
    });
    teamId = team.id;
  });

  afterAll(async () => {
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: false } });
    await prisma.leagueTeam.delete({ where: { id: teamId } });
    await prisma.teamCatalogItem.delete({ where: { id: catalogId } });
    await prisma.league.delete({ where: { id: leagueId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('returns the visible league for an active team with either database client', async () => {
    await expect(service.requireActive(teamId)).resolves.toBe(leagueId);
    await expect(prisma.$transaction((transaction) => service.requireActive(teamId, transaction)))
      .resolves.toBe(leagueId);
  });

  it('distinguishes an archived team from a missing or deleted league resource', async () => {
    await prisma.leagueTeam.update({ where: { id: teamId }, data: { status: 'ARCHIVED' } });
    await expect(service.requireActive(teamId)).rejects.toMatchObject({
      status: 409,
      response: { code: 'TEAM_ARCHIVED', message: 'League team has withdrawn' }
    });

    await expect(service.requireActive(randomUUID())).rejects.toMatchObject({
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND', message: 'League was not found' }
    });

    await prisma.leagueTeam.update({ where: { id: teamId }, data: { status: 'ACTIVE' } });
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: true } });
    await expect(service.requireActive(teamId)).rejects.toMatchObject({
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND', message: 'League was not found' }
    });
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: false } });
  });
});
