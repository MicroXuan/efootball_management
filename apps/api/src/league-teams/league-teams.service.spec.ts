import { randomUUID } from 'node:crypto';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueTeamsService } from './league-teams.service.js';

describe('LeagueTeamsService', () => {
  const prisma = new PrismaService();
  const userIds: string[] = [];
  const adminIds: string[] = [];
  const leagueIds: string[] = [];
  let service: LeagueTeamsService;
  let actorId: string;

  beforeAll(async () => {
    await prisma.$connect();
    service = new LeagueTeamsService(
      prisma,
      new AdminMutationReceiptService(prisma),
      new AuditLogService(prisma)
    );
  });

  beforeEach(async () => {
    const actor = await prisma.adminAccount.create({
      data: {
        username: `team-admin-${randomUUID()}`,
        displayName: '球队管理员',
        passwordHash: 'unused',
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    actorId = actor.id;
    adminIds.push(actor.id);
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { actorAdminId: { in: adminIds } } });
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId: { in: adminIds } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    await prisma.gameAccount.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: adminIds } } });
    userIds.length = 0;
    adminIds.length = 0;
    leagueIds.length = 0;
  });

  afterAll(() => prisma.$disconnect());

  async function createUser(label: string) {
    const user = await prisma.user.create({
      data: {
        wechatOpenId: `league-team-${label}-${randomUUID()}`,
        publicUserNo: String(700_000 + Math.floor(Math.random() * 299_999)),
        displayName: label
      }
    });
    userIds.push(user.id);
    const account = await prisma.gameAccount.create({
      data: {
        userId: user.id,
        platform: 'MOBILE',
        serverRegion: 'GLOBAL',
        gamerTag: `${label}-${randomUUID()}`,
        isDefault: true
      }
    });
    return { user, account };
  }

  async function createLeague(label: string) {
    const league = await prisma.league.create({
      data: {
        name: `${label}-${randomUUID()}`,
        shortName: label,
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdByAdminId: actorId
      }
    });
    leagueIds.push(league.id);
    return league;
  }

  it('allows one owner to have independent teams in different leagues', async () => {
    const { user, account } = await createUser('同一用户');
    const firstLeague = await createLeague('甲');
    const secondLeague = await createLeague('乙');

    const first = await service.create(actorId, firstLeague.id, {
      ownerUserId: user.id,
      teamNumber: 7,
      name: '甲联赛球队',
      shortName: '甲队',
      logoUrl: null,
      defaultGameAccountId: account.id
    }, randomUUID());
    const second = await service.create(actorId, secondLeague.id, {
      ownerUserId: user.id,
      teamNumber: 7,
      name: '乙联赛球队',
      shortName: '乙队',
      logoUrl: null,
      defaultGameAccountId: account.id
    }, randomUUID());

    expect(first.ownerUserId).toBe(second.ownerUserId);
    expect(first.leagueId).not.toBe(second.leagueId);
  });

  it('rejects duplicate owners and duplicate team numbers inside one league', async () => {
    const firstOwner = await createUser('一号');
    const secondOwner = await createUser('二号');
    const league = await createLeague('唯一约束');
    await service.create(actorId, league.id, {
      ownerUserId: firstOwner.user.id,
      teamNumber: 12,
      name: '一号队',
      shortName: '一号',
      logoUrl: null,
      defaultGameAccountId: firstOwner.account.id
    }, randomUUID());

    await expect(service.create(actorId, league.id, {
      ownerUserId: firstOwner.user.id,
      teamNumber: 13,
      name: '重复用户队',
      shortName: '重复',
      logoUrl: null,
      defaultGameAccountId: firstOwner.account.id
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_TEAM_OWNER_ALREADY_EXISTS' } });

    await expect(service.create(actorId, league.id, {
      ownerUserId: secondOwner.user.id,
      teamNumber: 12,
      name: '重复编号队',
      shortName: '重复号',
      logoUrl: null,
      defaultGameAccountId: secondOwner.account.id
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS' } });
  });

  it('keeps a migrated legacy team readable while its number awaits assignment', async () => {
    const { user } = await createUser('旧球队');
    const league = await createLeague('迁移');
    const migrated = await prisma.leagueTeam.create({
      data: {
        leagueId: league.id,
        ownerUserId: user.id,
        teamNumber: null,
        name: '迁移后的旧球队',
        shortName: '旧队',
        status: 'NEEDS_NUMBER'
      }
    });

    const result = await service.listMine(user.id);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: migrated.id,
        teamNumber: null,
        status: 'NEEDS_NUMBER'
      })
    ]);
  });
});
