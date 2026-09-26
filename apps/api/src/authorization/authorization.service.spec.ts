import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { AuthorizationService } from './authorization.service.js';

config({ path: '../../.env', quiet: true });

describe('AuthorizationService', () => {
  const prisma = new PrismaService();
  const service = new AuthorizationService(prisma);
  const suffix = randomUUID();
  const permissionCode = `competition.manage.${suffix}`;
  let userId: string;
  let roleId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        wechatOpenId: `authorization-test-${suffix}`,
        displayName: '权限测试玩家'
      }
    });
    const role = await prisma.role.create({
      data: {
        code: `TEST_ROLE_${suffix}`,
        name: '测试角色',
        permissions: {
          create: {
            permission: {
              create: { code: permissionCode, name: '管理赛事' }
            }
          }
        }
      }
    });
    userId = user.id;
    roleId = role.id;
  });

  beforeEach(async () => {
    await prisma.userRoleBinding.deleteMany({ where: { userId } });
    await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
  });

  afterAll(async () => {
    await prisma.userRoleBinding.deleteMany({ where: { userId } });
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.permission.delete({ where: { code: permissionCode } });
    await prisma.role.delete({ where: { id: roleId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function bind(
    scopeType: 'PLATFORM' | 'TEAM' | 'COMPETITION' | 'LEAGUE' | 'SEASON',
    scopeId?: string,
    expiresAt?: Date
  ) {
    await prisma.userRoleBinding.create({
      data: {
        userId,
        roleId,
        scopeType,
        scopeId: scopeId ?? null,
        expiresAt: expiresAt ?? null
      }
    });
  }

  it('allows a platform-wide permission for any resource scope', async () => {
    await bind('PLATFORM');

    await expect(
      service.can(userId, permissionCode, { type: 'COMPETITION', id: randomUUID() })
    ).resolves.toBe(true);
  });

  it('allows an exact team scope', async () => {
    const teamId = randomUUID();
    await bind('TEAM', teamId);

    await expect(service.can(userId, permissionCode, { type: 'TEAM', id: teamId }))
      .resolves.toBe(true);
  });

  it('denies a mismatched competition scope', async () => {
    await bind('COMPETITION', randomUUID());

    await expect(
      service.can(userId, permissionCode, { type: 'COMPETITION', id: randomUUID() })
    ).resolves.toBe(false);
  });

  it('allows an exact league scope and denies another league', async () => {
    const leagueId = randomUUID();
    await bind('LEAGUE', leagueId);

    await expect(service.can(userId, permissionCode, { type: 'LEAGUE', id: leagueId }))
      .resolves.toBe(true);
    await expect(service.can(userId, permissionCode, { type: 'LEAGUE', id: randomUUID() }))
      .resolves.toBe(false);
  });

  it('allows an exact season scope and denies another season', async () => {
    const seasonId = randomUUID();
    await bind('SEASON', seasonId);

    await expect(service.can(userId, permissionCode, { type: 'SEASON', id: seasonId }))
      .resolves.toBe(true);
    await expect(service.can(userId, permissionCode, { type: 'SEASON', id: randomUUID() }))
      .resolves.toBe(false);
  });

  it('denies an expired binding', async () => {
    const competitionId = randomUUID();
    await bind('COMPETITION', competitionId, new Date(Date.now() - 1_000));

    await expect(
      service.can(userId, permissionCode, { type: 'COMPETITION', id: competitionId })
    ).resolves.toBe(false);
  });

  it('denies a disabled user', async () => {
    await bind('PLATFORM');
    await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });

    await expect(service.can(userId, permissionCode)).resolves.toBe(false);
  });
});
