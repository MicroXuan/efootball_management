import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { AdminMutationReceiptService } from './admin-mutation-receipt.service.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { AuditLogService } from './audit-log.service.js';

config({ path: '../../.env', quiet: true });

describe('AdminAccountsService league grants', () => {
  const prisma = new PrismaService();
  const receipts = new AdminMutationReceiptService(prisma);
  const service = new AdminAccountsService(
    prisma,
    {} as never,
    receipts,
    new AuditLogService(prisma)
  );
  let actorAdminId: string;
  let managerAdminId: string;
  let userId: string;
  let leagueId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const [actor, manager, user] = await Promise.all([
      prisma.adminAccount.create({
        data: {
          username: `grant-actor-${randomUUID()}`,
          displayName: '平台管理员',
          passwordHash: 'unused',
          platformRole: 'PLATFORM_ADMIN'
        }
      }),
      prisma.adminAccount.create({
        data: {
          username: `grant-manager-${randomUUID()}`,
          displayName: '联赛管理员',
          passwordHash: 'unused',
          platformRole: 'LEAGUE_MANAGER'
        }
      }),
      prisma.user.create({
        data: { wechatOpenId: `grant-user-${randomUUID()}`, displayName: '创建者' }
      })
    ]);
    actorAdminId = actor.id;
    managerAdminId = manager.id;
    userId = user.id;
    const league = await prisma.league.create({
      data: {
        name: '授权列表联赛',
        shortName: '授权',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdById: userId
      }
    });
    leagueId = league.id;
    await prisma.adminLeagueRole.create({
      data: {
        adminId: managerAdminId,
        leagueId,
        role: 'LEAGUE_MANAGER',
        grantedById: actorAdminId
      }
    });
  });

  beforeEach(async () => {
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: false } });
  });

  afterEach(async () => {
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: false } });
  });

  afterAll(async () => {
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId: actorAdminId } });
    await prisma.auditLog.deleteMany({ where: { leagueId } });
    await prisma.adminLeagueRole.deleteMany({ where: { leagueId } });
    await prisma.league.delete({ where: { id: leagueId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: [actorAdminId, managerAdminId] } } });
    await prisma.$disconnect();
  });

  it('omits deleted league grants without removing their rows', async () => {
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: true } });

    await expect(service.listLeagueGrants(managerAdminId)).resolves.toEqual({ items: [] });
    await expect(prisma.adminLeagueRole.count({ where: { adminId: managerAdminId, leagueId } })).resolves.toBe(1);
  });

  it('rejects granting a deleted league before receipts or audit rows are written', async () => {
    const key = `grant-deleted-${randomUUID()}`;
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: true } });
    await expect(service.grantLeague(actorAdminId, managerAdminId, {
      leagueId,
      role: 'LEAGUE_MANAGER'
    }, key)).rejects.toMatchObject({
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND' }
    });
    await expect(prisma.adminMutationReceipt.count({
      where: { adminId: actorAdminId, key }
    })).resolves.toBe(0);
    await expect(prisma.auditLog.count({
      where: { leagueId, action: 'admin.league-grant.create' }
    })).resolves.toBe(0);
  });

  it('rejects revoking a grant from a deleted league without changing the grant', async () => {
    const grant = await prisma.adminLeagueRole.findFirstOrThrow({
      where: { adminId: managerAdminId, leagueId }
    });
    const key = `revoke-deleted-${randomUUID()}`;
    await prisma.league.update({ where: { id: leagueId }, data: { isDeleted: true } });

    await expect(service.revokeLeague(
      actorAdminId,
      managerAdminId,
      grant.id,
      grant.version,
      key
    )).rejects.toMatchObject({
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND' }
    });
    await expect(prisma.adminLeagueRole.findUniqueOrThrow({ where: { id: grant.id } })).resolves.toMatchObject({
      revokedAt: null,
      version: grant.version
    });
    await expect(prisma.adminMutationReceipt.count({ where: { adminId: actorAdminId, key } })).resolves.toBe(0);
  });
});
