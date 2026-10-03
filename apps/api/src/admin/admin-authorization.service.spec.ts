import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from './admin-authorization.service.js';

config({ path: '../../.env', quiet: true });

describe('AdminAuthorizationService', () => {
  const prisma = new PrismaService();
  const adminIds: string[] = [];
  const userIds: string[] = [];
  const leagueIds: string[] = [];
  let service: AdminAuthorizationService;

  beforeAll(async () => {
    await prisma.$connect();
    service = new AdminAuthorizationService(prisma);
  });

  afterEach(async () => {
    await prisma.adminLeagueRole.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: adminIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    adminIds.length = 0;
    userIds.length = 0;
    leagueIds.length = 0;
  });

  afterAll(() => prisma.$disconnect());

  async function createAdmin(
    platformRole: 'PLATFORM_ADMIN' | 'LEAGUE_MANAGER' | null,
    status: 'ACTIVE' | 'DISABLED' = 'ACTIVE'
  ) {
    const admin = await prisma.adminAccount.create({
      data: {
        username: `admin-${randomUUID()}`,
        displayName: '管理员',
        passwordHash: 'not-used-in-this-test',
        platformRole,
        status
      }
    });
    adminIds.push(admin.id);
    return admin;
  }

  async function createLeague() {
    const user = await prisma.user.create({
      data: {
        wechatOpenId: `openid-${randomUUID()}`,
        displayName: '创建者'
      }
    });
    userIds.push(user.id);
    const league = await prisma.league.create({
      data: {
        name: `联赛-${randomUUID()}`,
        shortName: '测试联赛',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdById: user.id
      }
    });
    leagueIds.push(league.id);
    return league;
  }

  async function expectCode(promise: Promise<unknown>, code: string) {
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({ code })
    });
  }

  it('allows only active platform administrators through the platform boundary', async () => {
    const platform = await createAdmin('PLATFORM_ADMIN');
    const manager = await createAdmin('LEAGUE_MANAGER');
    const disabled = await createAdmin('PLATFORM_ADMIN', 'DISABLED');

    await expect(service.requirePlatformAdmin(platform.id)).resolves.toMatchObject({ id: platform.id });
    await expectCode(service.requirePlatformAdmin(manager.id), 'ADMIN_PLATFORM_ACCESS_DENIED');
    await expectCode(service.requirePlatformAdmin(disabled.id), 'ADMIN_PLATFORM_ACCESS_DENIED');
  });

  it('allows an active manager only inside leagues with active grants', async () => {
    const platform = await createAdmin('PLATFORM_ADMIN');
    const manager = await createAdmin('LEAGUE_MANAGER');
    const disabled = await createAdmin('LEAGUE_MANAGER', 'DISABLED');
    const firstLeague = await createLeague();
    const secondLeague = await createLeague();

    const grant = await prisma.adminLeagueRole.create({
      data: {
        adminId: manager.id,
        leagueId: firstLeague.id,
        role: 'LEAGUE_MANAGER',
        grantedById: platform.id
      }
    });
    await prisma.adminLeagueRole.create({
      data: {
        adminId: disabled.id,
        leagueId: firstLeague.id,
        role: 'LEAGUE_MANAGER',
        grantedById: platform.id
      }
    });

    await expect(service.requireLeagueManager(manager.id, firstLeague.id)).resolves.toMatchObject({
      id: manager.id
    });
    await expectCode(
      service.requireLeagueManager(manager.id, secondLeague.id),
      'ADMIN_LEAGUE_ACCESS_DENIED'
    );
    await expectCode(
      service.requireLeagueManager(disabled.id, firstLeague.id),
      'ADMIN_LEAGUE_ACCESS_DENIED'
    );

    await prisma.adminLeagueRole.update({
      where: { id: grant.id },
      data: { revokedAt: new Date(), version: { increment: 1 } }
    });
    await expectCode(
      service.requireLeagueManager(manager.id, firstLeague.id),
      'ADMIN_LEAGUE_ACCESS_DENIED'
    );
  });
});
