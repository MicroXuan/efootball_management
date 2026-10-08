import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthService } from './admin-auth.service.js';

config({ path: '../../.env', quiet: true });

describe('AdminAuthService', () => {
  const prisma = new PrismaService();
  const service = new AdminAuthService(prisma, {} as never, {} as never);
  let adminId: string;
  let actorAdminId: string;
  let userId: string;
  let leagueId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [admin, actor, user] = await Promise.all([
      prisma.adminAccount.create({
        data: {
          username: `auth-me-${randomUUID()}`,
          displayName: '联赛管理员',
          passwordHash: 'unused',
          platformRole: 'LEAGUE_MANAGER'
        }
      }),
      prisma.adminAccount.create({
        data: {
          username: `auth-actor-${randomUUID()}`,
          displayName: '平台管理员',
          passwordHash: 'unused',
          platformRole: 'PLATFORM_ADMIN'
        }
      }),
      prisma.user.create({
        data: { wechatOpenId: `auth-me-${randomUUID()}`, displayName: '创建者' }
      })
    ]);
    adminId = admin.id;
    actorAdminId = actor.id;
    userId = user.id;
    const league = await prisma.league.create({
      data: {
        name: '授权可见性联赛',
        shortName: '授权',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: userId
      }
    });
    leagueId = league.id;
    await prisma.adminLeagueRole.create({
      data: {
        adminId,
        leagueId,
        role: 'LEAGUE_MANAGER',
        grantedById: actorAdminId
      }
    });
  });

  afterAll(async () => {
    await prisma.adminLeagueRole.deleteMany({ where: { leagueId } });
    await prisma.league.delete({ where: { id: leagueId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: [adminId, actorAdminId] } } });
    await prisma.$disconnect();
  });

  it('omits deleted league grants from the current administrator response', async () => {
    await expect(service.me(adminId)).resolves.toMatchObject({
      leagueGrants: [{ leagueId, leagueName: '授权可见性联赛' }]
    });

    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: true } });
    await expect(service.me(adminId)).resolves.toMatchObject({ leagueGrants: [] });
    await expect(prisma.adminLeagueRole.count({ where: { adminId, leagueId } })).resolves.toBe(1);
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: false } });
  });
});
