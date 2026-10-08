import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueTeamLifecycleService } from '../league-team-lifecycle/league-team-lifecycle.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { LeagueTeamsService } from './league-teams.service.js';

config({ path: '../../.env', quiet: true });

describe('LeagueTeamsService', () => {
  const prisma = new PrismaService();
  const userIds: string[] = [];
  const adminIds: string[] = [];
  const leagueIds: string[] = [];
  const catalogIds: string[] = [];
  let service: LeagueTeamsService;
  let actorId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const visibility = new LeagueVisibilityService(prisma);
    service = new LeagueTeamsService(
      prisma,
      new AdminMutationReceiptService(prisma),
      new AuditLogService(prisma),
      visibility,
      new LeagueTeamLifecycleService(prisma, visibility)
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
    await prisma.financeLedgerEntry.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.seasonEntry.deleteMany({ where: { season: { leagueId: { in: leagueIds } } } });
    await prisma.league.updateMany({
      where: { id: { in: leagueIds } },
      data: { currentSeasonId: null }
    });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.teamCatalogItem.deleteMany({ where: { id: { in: catalogIds } } });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    await prisma.gameAccount.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: adminIds } } });
    userIds.length = 0;
    adminIds.length = 0;
    leagueIds.length = 0;
    catalogIds.length = 0;
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
    return { user };
  }

  async function createLeague(label: string, withCurrentSeason = true) {
    const league = await prisma.league.create({
      data: {
        name: `${label}-${randomUUID()}`,
        shortName: label,
        edition: 'INTERNATIONAL',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'GLOBAL',
        createdByAdminId: actorId
      }
    });
    leagueIds.push(league.id);
    if (!withCurrentSeason) return league;
    const season = await prisma.leagueSeason.create({
      data: {
        leagueId: league.id,
        seasonNumber: 1,
        displayName: 'S1',
        isFirstSeason: true,
        registrationOpensAt: new Date('2026-09-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-09-08T00:00:00.000Z'),
        startsAt: new Date('2026-09-09T00:00:00.000Z'),
        endsAt: new Date('2026-10-09T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        createdByAdminId: actorId
      }
    });
    return prisma.league.update({
      where: { id: league.id },
      data: { currentSeasonId: season.id }
    });
  }

  async function createShell(
    name: string,
    options: { status?: 'ACTIVE' | 'DISABLED'; logoUrl?: string | null } = {}
  ) {
    const shell = await prisma.teamCatalogItem.create({
      data: {
        sourceType: 'CUSTOM',
        nameZh: name,
        shortName: name.slice(0, 24),
        storedLogoUrl: options.logoUrl ?? null,
        status: options.status ?? 'ACTIVE'
      }
    });
    catalogIds.push(shell.id);
    return shell;
  }

  it('rejects binding when the league has no current season and creates no orphan team', async () => {
    const { user } = await createUser('未开赛用户');
    const league = await createLeague('未设置赛季', false);
    const shell = await createShell('未开赛球队');

    await expect(service.create(actorId, league.id, {
      ownerUserId: user.id,
      ownerAlias: '未开赛经理',
      teamNumber: 1,
      catalogTeamId: shell.id
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_CURRENT_SEASON_REQUIRED' } });
    await expect(prisma.leagueTeam.count({ where: { leagueId: league.id } })).resolves.toBe(0);
  });

  it('rejects a disabled catalog shell before creating a team', async () => {
    const { user } = await createUser('停用队壳用户');
    const league = await createLeague('停用队壳');
    const shell = await createShell('停用球队', { status: 'DISABLED' });

    await expect(service.create(actorId, league.id, {
      ownerUserId: user.id,
      ownerAlias: '停用经理',
      teamNumber: 2,
      catalogTeamId: shell.id
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'TEAM_CATALOG_ITEM_UNAVAILABLE' } });
    await expect(prisma.leagueTeam.count({ where: { leagueId: league.id } })).resolves.toBe(0);
  });

  it('allows one owner to have independent teams in different leagues', async () => {
    const { user } = await createUser('同一用户');
    const firstLeague = await createLeague('甲');
    const secondLeague = await createLeague('乙');
    const shell = await createShell('跨联赛球队');

    const first = await service.create(actorId, firstLeague.id, {
      ownerUserId: user.id,
      ownerAlias: '甲联赛称呼',
      teamNumber: 7,
      catalogTeamId: shell.id
    }, randomUUID());
    const second = await service.create(actorId, secondLeague.id, {
      ownerUserId: user.id,
      ownerAlias: '乙联赛称呼',
      teamNumber: 7,
      catalogTeamId: shell.id
    }, randomUUID());

    expect(first.ownerUserId).toBe(second.ownerUserId);
    expect(first.leagueId).not.toBe(second.leagueId);
    await expect(prisma.seasonEntry.count({
      where: { leagueTeamId: { in: [first.id, second.id] }, status: 'APPROVED' }
    })).resolves.toBe(2);
    const mine = await service.listMineViews(user.id);
    expect(mine.items).toHaveLength(2);
    expect(mine.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        leagueId: firstLeague.id,
        leagueName: expect.any(String),
        leagueDescription: '',
        leagueLogoUrl: null,
        leagueEdition: 'INTERNATIONAL',
        currentSeason: expect.objectContaining({ id: firstLeague.currentSeasonId, approvedEntryCount: 1 })
      }),
      expect.objectContaining({ leagueId: secondLeague.id })
    ]));
  });

  it('rejects duplicate owners and duplicate team numbers inside one league', async () => {
    const firstOwner = await createUser('一号');
    const secondOwner = await createUser('二号');
    const league = await createLeague('唯一约束');
    const firstShell = await createShell('一号队');
    const secondShell = await createShell('二号队');
    await service.create(actorId, league.id, {
      ownerUserId: firstOwner.user.id,
      ownerAlias: '一号',
      teamNumber: 12,
      catalogTeamId: firstShell.id
    }, randomUUID());

    await expect(service.create(actorId, league.id, {
      ownerUserId: firstOwner.user.id,
      ownerAlias: '重复用户',
      teamNumber: 13,
      catalogTeamId: secondShell.id
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_TEAM_OWNER_ALREADY_EXISTS' } });

    await expect(service.create(actorId, league.id, {
      ownerUserId: secondOwner.user.id,
      ownerAlias: '二号',
      teamNumber: 12,
      catalogTeamId: secondShell.id
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS' } });
    await expect(prisma.seasonEntry.count({ where: { season: { leagueId: league.id } } })).resolves.toBe(1);
  });

  it('creates one approved current-season entry without a game account and replays idempotently', async () => {
    const { user } = await createUser('幂等用户');
    const league = await createLeague('幂等绑定');
    const shell = await createShell('幂等球队', { logoUrl: 'https://media.example/idempotent.webp' });
    const key = randomUUID();
    const input = {
      ownerUserId: user.id,
      ownerAlias: '幂等经理',
      teamNumber: 21,
      catalogTeamId: shell.id,
      name: '客户端伪造名称',
      logoUrl: 'https://outside.example/fake.png'
    };

    const first = await service.create(actorId, league.id, input as never, key);
    const replay = await service.create(actorId, league.id, input as never, key);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      name: '幂等球队',
      logoUrl: 'https://media.example/idempotent.webp',
      ownerAlias: '幂等经理',
      catalogTeamId: shell.id
    });
    await expect(prisma.seasonEntry.findMany({ where: { leagueTeamId: first.id } })).resolves.toEqual([
      expect.objectContaining({
        gameAccountId: null,
        source: 'NEW_APPLICATION',
        status: 'APPROVED',
        teamNameSnapshot: '幂等球队',
        leagueEditionSnapshot: 'INTERNATIONAL'
      })
    ]);
    await expect(prisma.auditLog.findFirst({
      where: { resourceId: first.id, action: 'CREATE_LEAGUE_TEAM' }
    })).resolves.toMatchObject({
      metadata: expect.objectContaining({ catalogTeamId: shell.id, ownerAlias: '幂等经理' })
    });
  });

  it('allows only one concurrent assignment of the same shell and leaves no orphan season entry', async () => {
    const first = await createUser('并发用户甲');
    const second = await createUser('并发用户乙');
    const league = await createLeague('并发绑定');
    const shell = await createShell('并发球队');
    const results = await Promise.allSettled([
      service.create(actorId, league.id, {
        ownerUserId: first.user.id,
        ownerAlias: '并发甲',
        teamNumber: 31,
        catalogTeamId: shell.id
      }, randomUUID()),
      service.create(actorId, league.id, {
        ownerUserId: second.user.id,
        ownerAlias: '并发乙',
        teamNumber: 32,
        catalogTeamId: shell.id
      }, randomUUID())
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { response: { code: 'LEAGUE_TEAM_SHELL_ALREADY_ASSIGNED' } }
    });
    await expect(prisma.leagueTeam.count({ where: { leagueId: league.id } })).resolves.toBe(1);
    await expect(prisma.seasonEntry.count({ where: { season: { leagueId: league.id } } })).resolves.toBe(1);
  });

  it('keeps a migrated legacy team readable while its number awaits assignment', async () => {
    const { user } = await createUser('旧球队');
    const league = await createLeague('迁移');
    const shell = await createShell('迁移后的旧球队');
    const migrated = await prisma.leagueTeam.create({
      data: {
        leagueId: league.id,
        ownerUserId: user.id,
        ownerAlias: '旧球队经理',
        catalogTeamId: shell.id,
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

  it('omits teams from deleted leagues and rejects direct reads and writes', async () => {
    const { user } = await createUser('逻辑删除球队用户');
    const league = await createLeague('逻辑删除球队联赛');
    const shell = await createShell('逻辑删除球队');
    const team = await service.create(actorId, league.id, {
      ownerUserId: user.id,
      ownerAlias: '逻辑删除经理',
      teamNumber: 41,
      catalogTeamId: shell.id
    }, randomUUID());
    await prisma.league.update({ where: { id: league.id }, data: { isDeleted: true } });
    const key = randomUUID();
    const expected = {
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND', message: 'League was not found' }
    };

    await expect(service.listMineViews(user.id)).resolves.toEqual({ items: [], nextCursor: null });
    await expect(service.getDetail(team.id, user.id)).rejects.toMatchObject(expected);
    await expect(service.update(actorId, league.id, team.id, {
      ownerAlias: '不应写入',
      expectedVersion: team.version
    }, key)).rejects.toMatchObject(expected);
    await expect(prisma.adminMutationReceipt.count({
      where: { adminId: actorId, operation: `league-team.update:${team.id}`, key }
    })).resolves.toBe(0);
    await expect(prisma.auditLog.count({
      where: { leagueId: league.id, resourceId: team.id, action: 'league-team.update' }
    })).resolves.toBe(0);
  });

  it('updates the team shell value with versioning, idempotency, and an audit record', async () => {
    const { user } = await createUser('队壳用户');
    const league = await createLeague('队壳价值');
    const shell = await createShell('队壳球队');
    const team = await service.create(actorId, league.id, {
      ownerUserId: user.id,
      ownerAlias: '队壳经理',
      teamNumber: 8,
      catalogTeamId: shell.id
    }, randomUUID());
    const key = randomUUID();

    const updated = await service.update(actorId, league.id, team.id, {
      shellValueMinor: 88_000,
      expectedVersion: team.version
    }, key);
    const replay = await service.update(actorId, league.id, team.id, {
      shellValueMinor: 88_000,
      expectedVersion: team.version
    }, key);

    expect(updated).toMatchObject({ shellValueMinor: 88_000, version: team.version + 1 });
    expect(replay).toEqual(updated);
    await expect(prisma.auditLog.count({
      where: { leagueId: league.id, resourceId: team.id, action: 'LEAGUE_TEAM_SHELL_VALUE_UPDATED' }
    })).resolves.toBe(1);
  });

  it('archives and restores a team without changing its identity or historical records', async () => {
    const { user } = await createUser('退出球队用户');
    const league = await createLeague('退出球队联赛');
    const shell = await createShell('退出球队');
    const team = await service.create(actorId, league.id, {
      ownerUserId: user.id,
      ownerAlias: '退出经理',
      teamNumber: 18,
      catalogTeamId: shell.id
    }, randomUUID());
    const seasonId = league.currentSeasonId!;
    const ledger = await prisma.financeLedgerEntry.create({
      data: {
        leagueId: league.id,
        leagueTeamId: team.id,
        seasonId,
        direction: 'CREDIT',
        type: 'MANUAL_ADJUSTMENT',
        amountMinor: 300,
        note: '退出前历史账本'
      }
    });
    const archiveKey = randomUUID();

    const archived = await service.archive(actorId, league.id, team.id, {
      expectedVersion: team.version,
      reason: '球队主动退出联赛'
    }, archiveKey);
    const replay = await service.archive(actorId, league.id, team.id, {
      expectedVersion: team.version,
      reason: '球队主动退出联赛'
    }, archiveKey);
    const repeatedWithAnotherKey = await service.archive(actorId, league.id, team.id, {
      expectedVersion: team.version,
      reason: '重复退出不应再次写入'
    }, randomUUID());

    expect(archived).toMatchObject({
      id: team.id,
      status: 'ARCHIVED',
      version: team.version + 1,
      teamNumber: 18,
      catalogTeamId: shell.id
    });
    expect(replay).toEqual(archived);
    expect(repeatedWithAnotherKey).toEqual(archived);
    await expect(prisma.seasonEntry.count({ where: { leagueTeamId: team.id } })).resolves.toBe(1);
    await expect(prisma.financeLedgerEntry.findUnique({ where: { id: ledger.id } })).resolves.toMatchObject({
      amountMinor: 300,
      note: '退出前历史账本'
    });
    await expect(prisma.auditLog.count({
      where: { resourceId: team.id, action: 'league-team.archive' }
    })).resolves.toBe(1);
    await expect(prisma.auditLog.findFirst({
      where: { resourceId: team.id, action: 'league-team.archive' }
    })).resolves.toMatchObject({ reason: '球队主动退出联赛' });

    const restored = await service.restore(actorId, league.id, team.id, {
      expectedVersion: archived.version,
      reason: '批准恢复球队'
    }, randomUUID());
    expect(restored).toMatchObject({
      id: team.id,
      status: 'ACTIVE',
      version: archived.version + 1,
      teamNumber: 18,
      catalogTeamId: shell.id
    });
    await expect(prisma.auditLog.findFirst({
      where: { resourceId: team.id, action: 'league-team.restore' }
    })).resolves.toMatchObject({ reason: '批准恢复球队' });
  });

  it('rejects invalid lifecycle transitions, stale versions, and deleted parents without side effects', async () => {
    const { user } = await createUser('状态校验用户');
    const league = await createLeague('状态校验联赛');
    const shell = await createShell('状态校验球队');
    const team = await service.create(actorId, league.id, {
      ownerUserId: user.id,
      ownerAlias: '状态经理',
      teamNumber: 19,
      catalogTeamId: shell.id
    }, randomUUID());

    await expect(service.archive(actorId, league.id, team.id, {
      expectedVersion: team.version + 1,
      reason: '错误版本'
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });

    await prisma.leagueTeam.update({ where: { id: team.id }, data: { status: 'NEEDS_NUMBER' } });
    await expect(service.archive(actorId, league.id, team.id, {
      expectedVersion: team.version,
      reason: '非法状态'
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_TEAM_STATE_INVALID' } });

    await prisma.leagueTeam.update({ where: { id: team.id }, data: { status: 'ACTIVE' } });
    await prisma.league.update({ where: { id: league.id }, data: { isDeleted: true } });
    const deletedKey = randomUUID();
    await expect(service.archive(actorId, league.id, team.id, {
      expectedVersion: team.version,
      reason: '不可绕过删除联赛'
    }, deletedKey)).rejects.toMatchObject({ status: 404 });
    await expect(prisma.adminMutationReceipt.count({ where: { adminId: actorId, key: deletedKey } })).resolves.toBe(0);
    await expect(prisma.auditLog.count({
      where: { resourceId: team.id, action: { in: ['league-team.archive', 'league-team.restore'] } }
    })).resolves.toBe(0);
  });

  it('separates active and archived admin lists while hiding archived user details', async () => {
    const { user } = await createUser('列表筛选用户');
    const league = await createLeague('列表筛选联赛');
    const shell = await createShell('列表筛选球队');
    const team = await service.create(actorId, league.id, {
      ownerUserId: user.id,
      ownerAlias: '列表经理',
      teamNumber: 20,
      catalogTeamId: shell.id
    }, randomUUID());
    await service.archive(actorId, league.id, team.id, {
      expectedVersion: team.version,
      reason: '验证列表筛选'
    }, randomUUID());

    await expect(service.listForLeague(league.id)).resolves.toEqual({ items: [], nextCursor: null });
    await expect(service.listForLeague(league.id, 'ACTIVE')).resolves.toEqual({ items: [], nextCursor: null });
    await expect(service.listForLeague(league.id, 'ARCHIVED')).resolves.toMatchObject({
      items: [expect.objectContaining({ id: team.id, status: 'ARCHIVED' })]
    });
    await expect(service.getAdminDetail(team.id, league.id)).resolves.toMatchObject({
      id: team.id,
      status: 'ARCHIVED'
    });
    await expect(service.getDetail(team.id, user.id)).rejects.toMatchObject({ status: 404 });
  });
});
