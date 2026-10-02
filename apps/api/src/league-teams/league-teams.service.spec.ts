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
    await prisma.seasonEntry.deleteMany({ where: { season: { leagueId: { in: leagueIds } } } });
    await prisma.league.updateMany({
      where: { id: { in: leagueIds } },
      data: { currentSeasonId: null }
    });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
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

  it('rejects binding when the league has no current season and creates no orphan team', async () => {
    const { user } = await createUser('未开赛用户');
    const league = await createLeague('未设置赛季', false);

    await expect(service.create(actorId, league.id, {
      ownerUserId: user.id,
      teamNumber: 1,
      name: '未开赛球队',
      shortName: '未开赛',
      logoUrl: null
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_CURRENT_SEASON_REQUIRED' } });
    await expect(prisma.leagueTeam.count({ where: { leagueId: league.id } })).resolves.toBe(0);
  });

  it('allows one owner to have independent teams in different leagues', async () => {
    const { user } = await createUser('同一用户');
    const firstLeague = await createLeague('甲');
    const secondLeague = await createLeague('乙');

    const first = await service.create(actorId, firstLeague.id, {
      ownerUserId: user.id,
      teamNumber: 7,
      name: '甲联赛球队',
      shortName: '甲队',
      logoUrl: null
    }, randomUUID());
    const second = await service.create(actorId, secondLeague.id, {
      ownerUserId: user.id,
      teamNumber: 7,
      name: '乙联赛球队',
      shortName: '乙队',
      logoUrl: null
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
    await service.create(actorId, league.id, {
      ownerUserId: firstOwner.user.id,
      teamNumber: 12,
      name: '一号队',
      shortName: '一号',
      logoUrl: null
    }, randomUUID());

    await expect(service.create(actorId, league.id, {
      ownerUserId: firstOwner.user.id,
      teamNumber: 13,
      name: '重复用户队',
      shortName: '重复',
      logoUrl: null
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_TEAM_OWNER_ALREADY_EXISTS' } });

    await expect(service.create(actorId, league.id, {
      ownerUserId: secondOwner.user.id,
      teamNumber: 12,
      name: '重复编号队',
      shortName: '重复号',
      logoUrl: null
    }, randomUUID())).rejects.toMatchObject({ response: { code: 'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS' } });
    await expect(prisma.seasonEntry.count({ where: { season: { leagueId: league.id } } })).resolves.toBe(1);
  });

  it('creates one approved current-season entry without a game account and replays idempotently', async () => {
    const { user } = await createUser('幂等用户');
    const league = await createLeague('幂等绑定');
    const key = randomUUID();
    const input = {
      ownerUserId: user.id,
      teamNumber: 21,
      name: '幂等球队',
      shortName: '幂等',
      logoUrl: null
    };

    const first = await service.create(actorId, league.id, input, key);
    const replay = await service.create(actorId, league.id, input, key);
    expect(replay).toEqual(first);
    await expect(prisma.seasonEntry.findMany({ where: { leagueTeamId: first.id } })).resolves.toEqual([
      expect.objectContaining({
        gameAccountId: null,
        source: 'NEW_APPLICATION',
        status: 'APPROVED',
        teamNameSnapshot: '幂等球队',
        leagueEditionSnapshot: 'INTERNATIONAL'
      })
    ]);
  });

  it('serializes concurrent bindings and leaves no orphan season entry', async () => {
    const { user } = await createUser('并发用户');
    const league = await createLeague('并发绑定');
    const results = await Promise.allSettled([
      service.create(actorId, league.id, {
        ownerUserId: user.id,
        teamNumber: 31,
        name: '并发球队甲',
        shortName: '并发甲',
        logoUrl: null
      }, randomUUID()),
      service.create(actorId, league.id, {
        ownerUserId: user.id,
        teamNumber: 32,
        name: '并发球队乙',
        shortName: '并发乙',
        logoUrl: null
      }, randomUUID())
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(prisma.leagueTeam.count({ where: { leagueId: league.id } })).resolves.toBe(1);
    await expect(prisma.seasonEntry.count({ where: { season: { leagueId: league.id } } })).resolves.toBe(1);
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

  it('updates the team shell value with versioning, idempotency, and an audit record', async () => {
    const { user } = await createUser('队壳用户');
    const league = await createLeague('队壳价值');
    const team = await service.create(actorId, league.id, {
      ownerUserId: user.id,
      teamNumber: 8,
      name: '队壳球队',
      shortName: '队壳',
      logoUrl: null
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
});
