import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueTeamShellsService } from './league-team-shells.service.js';

config({ path: '../../.env', quiet: true });

describe('LeagueTeamShellsService', () => {
  const prisma = new PrismaService();
  const ids = { admins: [] as string[], users: [] as string[], leagues: [] as string[], catalogs: [] as string[] };
  let service: LeagueTeamShellsService;
  let adminId: string;

  beforeAll(async () => {
    await prisma.$connect();
    service = new LeagueTeamShellsService(
      prisma,
      new AdminMutationReceiptService(prisma),
      new AuditLogService(prisma)
    );
  });

  beforeEach(async () => {
    const admin = await prisma.adminAccount.create({ data: {
      username: `shell-admin-${randomUUID()}`, displayName: '队壳管理员', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
    } });
    adminId = admin.id;
    ids.admins.push(admin.id);
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { actorAdminId: { in: ids.admins } } });
    await prisma.adminMutationReceipt.deleteMany({ where: { adminId: { in: ids.admins } } });
    await prisma.leagueTeamShellHistory.deleteMany({ where: { leagueId: { in: ids.leagues } } });
    await prisma.seasonEntry.deleteMany({ where: { season: { leagueId: { in: ids.leagues } } } });
    await prisma.league.updateMany({ where: { id: { in: ids.leagues } }, data: { currentSeasonId: null } });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: ids.leagues } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: ids.leagues } } });
    await prisma.teamCatalogItem.deleteMany({ where: { id: { in: ids.catalogs } } });
    await prisma.league.deleteMany({ where: { id: { in: ids.leagues } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: ids.admins } } });
    Object.values(ids).forEach((values) => { values.length = 0; });
  });

  afterAll(() => prisma.$disconnect());

  async function shell(name: string, logo = `https://assets.example/${name}.png`) {
    const item = await prisma.teamCatalogItem.create({ data: {
      sourceType: 'CUSTOM', nameZh: name, shortName: name.slice(0, 8), storedLogoUrl: logo
    } });
    ids.catalogs.push(item.id);
    return item;
  }

  async function setup() {
    const league = await prisma.league.create({ data: {
      name: `测试联赛-${randomUUID()}`, shortName: '测试', edition: 'INTERNATIONAL',
      defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL', createdByAdminId: adminId
    } });
    ids.leagues.push(league.id);
    const users = await Promise.all(['甲', '乙'].map(async (label, index) => {
      const user = await prisma.user.create({ data: {
        wechatOpenId: `shell-user-${randomUUID()}`, publicUserNo: `80${index}001`, displayName: label
      } });
      ids.users.push(user.id);
      return user;
    }));
    const shells = await Promise.all(['阿贾克斯', '马德里竞技', '雷恩', '欧塞尔'].map((name) => shell(name)));
    const teams = await Promise.all(users.map((user, index) => prisma.leagueTeam.create({ data: {
      leagueId: league.id, ownerUserId: user.id, ownerAlias: index ? '老肥' : 'tidus',
      catalogTeamId: shells[index]!.id, teamNumber: index + 3,
      name: shells[index]!.nameZh!, shortName: shells[index]!.shortName, logoUrl: shells[index]!.storedLogoUrl
    } })));
    return { league, shells, teams };
  }

  function stable(team: Awaited<ReturnType<typeof prisma.leagueTeam.findUniqueOrThrow>>) {
    return {
      ownerUserId: team.ownerUserId, ownerAlias: team.ownerAlias, teamNumber: team.teamNumber,
      status: team.status, shellValueMinor: team.shellValueMinor, defaultGameAccountId: team.defaultGameAccountId
    };
  }

  it('changes and refreshes only shell fields while preserving team identity', async () => {
    const { league, shells, teams } = await setup();
    const before = stable(teams[0]!);

    await service.changeShell(adminId, league.id, teams[0]!.id, {
      catalogTeamId: shells[2]!.id, expectedVersion: 1, reason: '换队壳'
    }, randomUUID());
    const changed = await prisma.leagueTeam.findUniqueOrThrow({ where: { id: teams[0]!.id } });
    expect(stable(changed)).toEqual(before);
    expect(changed).toMatchObject({ catalogTeamId: shells[2]!.id, name: '雷恩', version: 2 });

    await prisma.teamCatalogItem.update({ where: { id: shells[2]!.id }, data: {
      nameZh: '雷恩足球俱乐部', storedLogoUrl: 'https://assets.example/rennes-new.webp'
    } });
    await service.refreshShell(adminId, league.id, teams[0]!.id, {
      catalogTeamId: shells[2]!.id, expectedVersion: 2
    }, randomUUID());
    const refreshed = await prisma.leagueTeam.findUniqueOrThrow({ where: { id: teams[0]!.id } });
    expect(stable(refreshed)).toEqual(before);
    expect(refreshed).toMatchObject({ name: '雷恩足球俱乐部', logoUrl: 'https://assets.example/rennes-new.webp', version: 3 });
    await expect(prisma.auditLog.findMany({ where: { resourceId: teams[0]!.id }, orderBy: { createdAt: 'asc' } }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'CHANGE_TEAM_SHELL' }),
        expect.objectContaining({ action: 'REFRESH_TEAM_SHELL' })
      ]));
  });

  it('transfers a shell only when the source receives an available replacement', async () => {
    const { league, shells, teams } = await setup();
    const identities = teams.map(stable);

    await service.transferShell(adminId, league.id, teams[0]!.id, {
      targetTeamId: teams[1]!.id,
      sourceReplacementCatalogTeamId: shells[2]!.id,
      expectedSourceVersion: 1,
      expectedTargetVersion: 1,
      reason: '用户退出联赛后转让队壳'
    }, randomUUID());

    const updated = await prisma.leagueTeam.findMany({ where: { id: { in: teams.map(({ id }) => id) } }, orderBy: { teamNumber: 'asc' } });
    expect(updated.map(stable)).toEqual(identities);
    expect(updated[0]).toMatchObject({ catalogTeamId: shells[2]!.id, name: '雷恩' });
    expect(updated[1]).toMatchObject({ catalogTeamId: shells[0]!.id, name: '阿贾克斯' });
    await expect(prisma.leagueTeamShellHistory.count({ where: { leagueId: league.id, changeType: 'TRANSFER' } })).resolves.toBe(2);
  });

  it('swaps two occupied shells atomically and rejects occupied change targets', async () => {
    const { league, shells, teams } = await setup();
    await expect(service.changeShell(adminId, league.id, teams[0]!.id, {
      catalogTeamId: shells[1]!.id, expectedVersion: 1
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_TEAM_SHELL_ALREADY_ASSIGNED' } });

    await service.swapShells(adminId, league.id, {
      sourceTeamId: teams[0]!.id, otherTeamId: teams[1]!.id,
      expectedSourceVersion: 1, expectedOtherVersion: 1
    }, randomUUID());
    const [first, second] = await Promise.all(teams.map(({ id }) => prisma.leagueTeam.findUniqueOrThrow({ where: { id } })));
    expect(first!.catalogTeamId).toBe(shells[1]!.id);
    expect(second!.catalogTeamId).toBe(shells[0]!.id);
    expect(first!.ownerUserId).toBe(teams[0]!.ownerUserId);
    expect(second!.ownerUserId).toBe(teams[1]!.ownerUserId);
  });

  it('serializes concurrent shell changes and returns a domain version conflict', async () => {
    const { league, shells, teams } = await setup();
    const results = await Promise.allSettled([
      service.changeShell(adminId, league.id, teams[0]!.id, {
        catalogTeamId: shells[2]!.id, expectedVersion: 1
      }, randomUUID()),
      service.changeShell(adminId, league.id, teams[0]!.id, {
        catalogTeamId: shells[3]!.id, expectedVersion: 1
      }, randomUUID())
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { response: { code: 'VERSION_CONFLICT' } }
    });
    await expect(prisma.leagueTeamShellHistory.count({ where: { leagueTeamId: teams[0]!.id } })).resolves.toBe(1);
  });
});
