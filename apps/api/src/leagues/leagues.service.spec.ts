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
    defaultPlatform: 'MOBILE' as const,
    defaultServerRegion: 'GLOBAL',
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
      featuredSeason: null,
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
});
