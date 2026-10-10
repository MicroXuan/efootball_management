import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeaguesService } from './leagues.service.js';

config({ path: '../../.env', quiet: true });

describe('LeaguesService', () => {
  const prisma = new PrismaService();
  const service = new LeaguesService(
    prisma,
    new MutationReceiptService(prisma),
    new AuthorizationService(prisma)
  );
  const suffix = randomUUID();
  const leagueIds: string[] = [];
  const catalogIds: string[] = [];
  let actorId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const actor = await prisma.user.create({
      data: { wechatOpenId: `league-service-${suffix}`, displayName: '联赛创建者' }
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    await prisma.mutationReceipt.deleteMany({ where: { actorId } });
    await prisma.seasonEntry.deleteMany({ where: { season: { leagueId: { in: leagueIds } } } });
    await prisma.league.updateMany({
      where: { id: { in: leagueIds } },
      data: { currentSeasonId: null }
    });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.leagueTeam.deleteMany({ where: { leagueId: { in: leagueIds } } });
    await prisma.teamCatalogItem.deleteMany({ where: { id: { in: catalogIds } } });
    await prisma.userRoleBinding.deleteMany({
      where: { OR: [{ userId: actorId }, { scopeId: { in: leagueIds } }] }
    });
    await prisma.league.deleteMany({ where: { id: { in: leagueIds } } });
    await prisma.user.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  const input = {
    name: 'CELL 传奇联赛',
    shortName: 'CELL',
    description: '长期运营联赛',
    logoUrl: null,
    edition: 'INTERNATIONAL' as const,
    defaultSuperCapacity: 23,
    defaultChampionCapacity: 18,
    defaultPromotionCount: 4
  };

  it('creates default rules and a scoped league manager binding', async () => {
    const created = await service.create(actorId, input, `create-${suffix}`);
    leagueIds.push(created.id);

    expect(created).toMatchObject({
      name: input.name,
      defaultSuperCapacity: 23,
      defaultChampionCapacity: 18,
      defaultPromotionCount: 4,
      currentSeason: null,
      version: 1,
      capabilities: { canManage: true, canCreateSeason: true }
    });
    await expect(prisma.userRoleBinding.findFirst({
      where: {
        userId: actorId,
        scopeType: 'LEAGUE',
        scopeId: created.id,
        role: { code: 'LEAGUE_MANAGER' }
      }
    })).resolves.not.toBeNull();
  });

  it('replays an idempotent create without creating another league', async () => {
    const key = `replay-${suffix}`;
    const first = await service.create(actorId, { ...input, name: '幂等联赛' }, key);
    leagueIds.push(first.id);
    const replay = await service.create(actorId, { ...input, name: '被忽略的名称' }, key);

    expect(replay).toEqual(first);
    await expect(prisma.league.count({ where: { id: first.id } })).resolves.toBe(1);
  });

  it('updates defaults with optimistic concurrency and rejects stale writes', async () => {
    const created = await service.create(actorId, { ...input, name: '更新联赛' }, `update-create-${suffix}`);
    leagueIds.push(created.id);

    const updated = await service.update(actorId, created.id, {
      defaultSuperCapacity: 24,
      defaultChampionCapacity: 16,
      defaultPromotionCount: 5,
      expectedVersion: created.version
    }, `update-${suffix}`);
    expect(updated).toMatchObject({
      defaultSuperCapacity: 24,
      defaultChampionCapacity: 16,
      defaultPromotionCount: 5,
      version: 2
    });

    await expect(service.update(actorId, created.id, {
      name: '过期修改',
      expectedVersion: created.version
    }, `stale-${suffix}`)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('lists only active leagues but keeps archived detail addressable', async () => {
    const created = await service.create(actorId, { ...input, name: '归档联赛' }, `archive-create-${suffix}`);
    leagueIds.push(created.id);
    await service.update(actorId, created.id, {
      status: 'ARCHIVED',
      expectedVersion: created.version
    }, `archive-${suffix}`);

    const page = await service.listPublic({ limit: 100 });
    expect(page.items.some((league) => league.id === created.id)).toBe(false);
    await expect(service.getPublic(created.id)).resolves.toMatchObject({
      id: created.id,
      status: 'ARCHIVED'
    });
  });

  it('defaults new leagues to visible and omits them after logical deletion', async () => {
    const created = await service.create(actorId, {
      ...input,
      name: '逻辑删除联赛'
    }, `logical-delete-${suffix}`);
    leagueIds.push(created.id);

    const stored = await prisma.league.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.isDeleted).toBe(false);

    await prisma.league.update({ where: { id: created.id }, data: { isDeleted: true } });

    const page = await service.listPublic({ limit: 100 });
    expect(page.items.some((league) => league.id === created.id)).toBe(false);
  });

  it('rejects deleted league detail and update without persisting a receipt, then restores access', async () => {
    const created = await service.create(actorId, {
      ...input,
      name: '可恢复联赛'
    }, `logical-restore-create-${suffix}`);
    leagueIds.push(created.id);
    await prisma.league.update({ where: { id: created.id }, data: { isDeleted: true } });
    const updateKey = `logical-restore-update-${suffix}`;
    const expected = {
      status: 404,
      response: { code: 'LEAGUE_NOT_FOUND', message: 'League was not found' }
    };

    await expect(service.getPublic(created.id)).rejects.toMatchObject(expected);
    await expect(service.update(actorId, created.id, {
      name: '不应写入的名称',
      expectedVersion: created.version
    }, updateKey)).rejects.toMatchObject(expected);
    await expect(prisma.mutationReceipt.count({
      where: { actorId, operation: `league.update:${created.id}`, key: updateKey }
    })).resolves.toBe(0);
    await expect(prisma.league.findUniqueOrThrow({ where: { id: created.id } })).resolves.toMatchObject({
      name: '可恢复联赛',
      version: created.version,
      isDeleted: true
    });

    await prisma.league.update({ where: { id: created.id }, data: { isDeleted: false } });
    await expect(service.getPublic(created.id)).resolves.toMatchObject({
      id: created.id,
      name: '可恢复联赛',
      version: created.version
    });
  });

  it('uses only the explicitly selected current season and its live approved count', async () => {
    const created = await service.create(actorId, {
      ...input,
      name: '显式当前赛季联赛'
    }, `current-season-${suffix}`);
    leagueIds.push(created.id);
    const shell = await prisma.teamCatalogItem.create({
      data: { sourceType: 'CUSTOM', nameZh: '测试球队', shortName: '测试' }
    });
    catalogIds.push(shell.id);
    const team = await prisma.leagueTeam.create({
      data: {
        leagueId: created.id,
        ownerUserId: actorId,
        ownerAlias: '测试用户',
        catalogTeamId: shell.id,
        teamNumber: 3,
        name: '测试球队',
        shortName: '测试'
      }
    });
    const first = await prisma.leagueSeason.create({
      data: {
        leagueId: created.id,
        seasonNumber: 1,
        displayName: '状态更优但未选中的赛季',
        isFirstSeason: true,
        registrationOpensAt: new Date('2026-07-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-07-08T00:00:00.000Z'),
        startsAt: new Date('2026-07-09T00:00:00.000Z'),
        endsAt: new Date('2026-08-09T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        status: 'IN_PROGRESS',
        createdById: actorId
      }
    });
    const selected = await prisma.leagueSeason.create({
      data: {
        leagueId: created.id,
        seasonNumber: 2,
        displayName: '管理员选中的赛季',
        isFirstSeason: false,
        registrationOpensAt: new Date('2026-09-01T00:00:00.000Z'),
        registrationClosesAt: new Date('2026-09-08T00:00:00.000Z'),
        startsAt: new Date('2026-09-09T00:00:00.000Z'),
        endsAt: new Date('2026-10-09T00:00:00.000Z'),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        status: 'DRAFT',
        createdById: actorId
      }
    });
    await prisma.league.update({ where: { id: created.id }, data: { currentSeasonId: selected.id } });
    const entry = await prisma.seasonEntry.create({
      data: {
        seasonId: selected.id,
        leagueTeamId: team.id,
        ownerUserId: actorId,
        source: 'NEW_APPLICATION',
        status: 'APPROVED',
        teamNameSnapshot: team.name,
        teamShortNameSnapshot: team.shortName,
        teamNumberSnapshot: team.teamNumber,
        leagueEditionSnapshot: 'INTERNATIONAL'
      }
    });

    await expect(service.getPublic(created.id)).resolves.toMatchObject({
      currentSeason: { id: selected.id, displayName: '管理员选中的赛季', approvedEntryCount: 1 }
    });
    await prisma.seasonEntry.update({ where: { id: entry.id }, data: { status: 'WITHDRAWN' } });
    await expect(service.getPublic(created.id)).resolves.toMatchObject({
      currentSeason: { id: selected.id, approvedEntryCount: 0 }
    });
    await prisma.league.update({ where: { id: created.id }, data: { currentSeasonId: first.id } });
    await expect(service.getPublic(created.id)).resolves.toMatchObject({
      currentSeason: { id: first.id, approvedEntryCount: 0 }
    });
    await expect(prisma.seasonEntry.count({ where: { seasonId: first.id } })).resolves.toBe(0);
  });
});
