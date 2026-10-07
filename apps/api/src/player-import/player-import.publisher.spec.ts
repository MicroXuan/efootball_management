import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerImportPublisher } from './player-import.publisher.js';
import { PlayerImportService } from './player-import.service.js';
import { PlayerBuildsService } from '../player-builds/player-builds.service.js';

config({ path: '../../.env', quiet: true });

describe('PlayerImportPublisher', () => {
  const prisma = new PrismaService();
  const userAuthorizationCalls: Array<[string, string]> = [];
  const authorization = { can: async (id: string, permission: string) => {
    userAuthorizationCalls.push([id, permission]);
    return true;
  } };
  const platformAuthorizationCalls: string[] = [];
  const adminAuthorization = { requirePlatformAdmin: async (id: string) => {
    platformAuthorizationCalls.push(id);
    return { id };
  } };
  const service = new PlayerImportService(prisma, authorization as never, adminAuthorization as never);
  const builds = new PlayerBuildsService(prisma);
  const publisher = new PlayerImportPublisher(prisma, authorization as never, builds, adminAuthorization as never);
  const actorId = randomUUID();
  const adminId = randomUUID();
  let sourceId: string;
  let sourceCode: string;

  const card = (externalId: string, overrides: Record<string, unknown> = {}) => ({
    externalId,
    playerExternalId: `player-${externalId}`,
    playerNameEn: `Publisher Test ${externalId}`,
    playerNameZh: `发布测试 ${externalId}`,
    nationality: 'Argentina',
    club: 'Test FC',
    cardName: 'Featured',
    position: 'CMF',
    overallRating: 95,
    cardType: 'FEATURED',
    status: 'ACTIVE',
    packExternalId: `pack-${externalId}`,
    packName: `Pack ${externalId}`,
    season: 'S1',
    releaseDate: '2026-09-24',
    skills: [`Passing ${externalId}`],
    attributes: { passing: 96 },
    ...overrides
  });

  const createBatch = (rows: unknown[]) => service.createBatch(actorId, {
    sourceCode,
    fileName: `${randomUUID()}.json`,
    format: 'JSON',
    content: JSON.stringify(rows)
  });

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: { id: actorId, wechatOpenId: `publisher-test-${actorId}`, displayName: '发布测试员' }
    });
  });

  beforeEach(async () => {
    userAuthorizationCalls.length = 0;
    platformAuthorizationCalls.length = 0;
    sourceCode = `publisher-${randomUUID()}`;
    const source = await prisma.dataSource.create({ data: { code: sourceCode, name: 'Publisher test' } });
    sourceId = source.id;
  });

  afterEach(async () => {
    const cards = await prisma.playerCard.findMany({ where: { sourceId }, select: { id: true, playerId: true } });
    const cardIds = cards.map(({ id }) => id);
    const playerIds = [...new Set(cards.map(({ playerId }) => playerId))];
    if (playerIds.length) {
      await prisma.footballPlayerBestCard.deleteMany({ where: { footballPlayerId: { in: playerIds } } });
    }
    if (cardIds.length) await prisma.playerCardAutoBuild.deleteMany({ where: { playerCardId: { in: cardIds } } });
    if (cardIds.length) await prisma.playerCardVersion.deleteMany({ where: { playerCardId: { in: cardIds } } });
    await prisma.catalogRelease.deleteMany({ where: { batch: { sourceId } } });
    await prisma.importBatch.deleteMany({ where: { sourceId } });
    await prisma.playerCard.deleteMany({ where: { sourceId } });
    await prisma.cardPack.deleteMany({ where: { sourceId } });
    await prisma.footballPlayerSource.deleteMany({ where: { sourceId } });
    if (playerIds.length) await prisma.footballPlayer.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.dataSource.delete({ where: { id: sourceId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('publishes a complete CREATE graph and immutable version', async () => {
    const batch = await createBatch([card('create')]);
    const published = await publisher.publish(actorId, batch.id);
    const stored = await prisma.playerCard.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: 'create' } },
      include: { player: { include: { sources: true } }, cardPack: true, skills: true, attributes: true, versions: true }
    });

    expect(published.status).toBe('PUBLISHED');
    expect(published.releaseSequence).toBeGreaterThan(0);
    expect(stored?.player.sources).toHaveLength(1);
    expect(stored?.cardPack?.externalId).toBe('pack-create');
    expect(stored?.skills).toHaveLength(1);
    expect(stored?.attributes?.attributesJson).toEqual({ passing: 96 });
    expect(stored?.versions).toHaveLength(1);
    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(1);
  });

  it('publishes for a platform administrator without checking user scopes', async () => {
    const batch = await createBatch([card('platform-publish')]);
    userAuthorizationCalls.length = 0;

    const published = await publisher.publishForPlatformAdmin(adminId, batch.id);

    expect(published.status).toBe('PUBLISHED');
    expect(platformAuthorizationCalls).toEqual([adminId]);
    expect(userAuthorizationCalls).toEqual([]);
  });

  it('keeps ordinary publication on user scope authorization', async () => {
    const batch = await createBatch([card('user-publish')]);
    userAuthorizationCalls.length = 0;

    await publisher.publish(actorId, batch.id);

    expect(userAuthorizationCalls).toContainEqual([actorId, 'catalog.import.publish']);
    expect(platformAuthorizationCalls).toEqual([]);
  });

  it('persists a source-provided automatic build and refreshes the recommended card', async () => {
    const batch = await createBatch([card('auto-build', {
      autoBuildAllocation: { defending: 12, aerialStrength: 8 },
      autoBuildMaxOverall: 98,
      dtRating: 97,
      algorithmVersion: 'pesdata-auto-v1'
    })]);

    await publisher.publish(actorId, batch.id);

    const stored = await prisma.playerCard.findUniqueOrThrow({
      where: { sourceId_externalId: { sourceId, externalId: 'auto-build' } },
      include: { autoBuilds: true, player: { include: { bestCard: true } } }
    });
    expect(stored.autoBuilds).toHaveLength(1);
    expect(stored.autoBuilds[0]).toMatchObject({ maxOverall: 98, dtRating: 97 });
    expect(stored.player.bestCard?.playerCardId).toBe(stored.id);
  });

  it('updates only reviewed source fields and preserves omitted cards', async () => {
    const initial = await createBatch([card('keep'), card('update')]);
    await publisher.publish(actorId, initial.id);
    const update = await createBatch([card('update', { overallRating: 97 })]);

    await publisher.publish(actorId, update.id);

    const kept = await prisma.playerCard.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: 'keep' } }
    });
    const changed = await prisma.playerCard.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: 'update' } }
    });
    expect(kept?.status).toBe('ACTIVE');
    expect(changed?.overallRating).toBe(97);
    expect(changed?.cardName).toBe('Featured');
  });

  it('rejects invalid and cancelled batches', async () => {
    const invalid = await createBatch([card('duplicate'), card('duplicate')]);
    await expect(publisher.publish(actorId, invalid.id)).rejects.toMatchObject({ code: 'IMPORT_BATCH_NOT_READY' });

    const cancelled = await createBatch([card('cancelled')]);
    await service.cancelBatch(actorId, cancelled.id);
    await expect(publisher.publish(actorId, cancelled.id)).rejects.toMatchObject({ code: 'IMPORT_BATCH_NOT_READY' });
  });

  it('publishes an explicit INACTIVE update', async () => {
    const initial = await createBatch([card('inactive')]);
    await publisher.publish(actorId, initial.id);
    const inactive = await createBatch([card('inactive', { status: 'INACTIVE' })]);

    await publisher.publish(actorId, inactive.id);

    await expect(prisma.playerCard.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: 'inactive' } },
      select: { status: true }
    })).resolves.toEqual({ status: 'INACTIVE' });
  });

  it('rolls back release and formal rows when a later record fails', async () => {
    const batch = await createBatch([card('rollback-a'), card('rollback-b')]);
    const second = await prisma.importRecord.findFirstOrThrow({
      where: { batchId: batch.id, rowNumber: 2 }
    });
    await prisma.importRecord.update({
      where: { id: second.id },
      data: { normalizedJson: Prisma.JsonNull }
    });

    await expect(publisher.publish(actorId, batch.id)).rejects.toThrow();

    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(0);
    await expect(prisma.playerCard.count({ where: { sourceId } })).resolves.toBe(0);
    await expect(prisma.importBatch.findUnique({ where: { id: batch.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'READY' });
  });

  it('returns one release for concurrent publish calls', async () => {
    const batch = await createBatch([card('concurrent')]);

    const [left, right] = await Promise.all([
      publisher.publish(actorId, batch.id),
      publisher.publish(actorId, batch.id)
    ]);

    expect(left.releaseId).toBe(right.releaseId);
    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(1);
  });
});
