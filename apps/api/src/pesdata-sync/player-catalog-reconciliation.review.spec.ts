import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerCatalogReconciliationReview } from './player-catalog-reconciliation.review.js';

describe('PlayerCatalogReconciliationReview', () => {
  const prisma = new PrismaService();
  const actorId = randomUUID();
  let sourceId = '';
  const publisher = { publishForPlatformAdmin: async () => ({ status: 'PUBLISHED' }) };

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.adminAccount.create({ data: { id: actorId, username: `review-${actorId}`,
      displayName: '审核测试', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN' } });
    sourceId = (await prisma.dataSource.upsert({ where: { code: 'pesdata' }, update: {},
      create: { code: 'pesdata', name: 'PESDATA', type: 'API' } })).id;
  });

  afterEach(async () => {
    const links = await prisma.externalSyncRunBatch.findMany({ where: { run: { actorId } }, select: { batchId: true } });
    await prisma.externalSyncRun.deleteMany({ where: { actorId } });
    await prisma.importBatch.deleteMany({ where: { id: { in: links.map(({ batchId }) => batchId) } } });
  });

  afterAll(async () => {
    await prisma.adminAccount.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('refuses to publish an untrusted run', async () => {
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId, mode: 'RECONCILE', status: 'READY', scanTrusted: false
    } });
    const review = new PlayerCatalogReconciliationReview(prisma,
      { requirePlatformAdmin: async () => ({ id: actorId }) } as never, publisher as never);
    await expect(review.publishValid(actorId, run.id)).rejects.toThrow('SCAN_NOT_TRUSTED');
  });

  it('publishes only a valid batch and skips a failed batch', async () => {
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId, mode: 'RECONCILE', status: 'READY', scanTrusted: true,
      businessDate: new Date('2026-10-23T00:00:00Z'), finishedAt: new Date()
    } });
    const good = await prisma.importBatch.create({ data: { sourceId, createdBy: actorId, fileName: 'good.json',
      format: 'JSON', checksum: randomUUID().replaceAll('-', '').padEnd(64, '0'), status: 'READY' } });
    const failed = await prisma.importBatch.create({ data: { sourceId, createdBy: actorId, fileName: 'failed.json',
      format: 'JSON', checksum: randomUUID().replaceAll('-', '').padEnd(64, '0'), status: 'FAILED' } });
    await prisma.externalSyncRunBatch.createMany({ data: [
      { runId: run.id, batchId: good.id, chunkIndex: 1 },
      { runId: run.id, batchId: failed.id, chunkIndex: 2 }
    ] });
    await prisma.playerCatalogReconciliationItem.create({ data: {
      runId: run.id, externalId: `new-${randomUUID()}`, changeType: 'ADDED', batchId: good.id
    } });
    let calls = 0;
    const review = new PlayerCatalogReconciliationReview(prisma,
      { requirePlatformAdmin: async () => ({ id: actorId }) } as never,
      { publishForPlatformAdmin: async () => { calls += 1; return { status: 'PUBLISHED' }; } } as never);
    expect(await review.publishValid(actorId, run.id)).toMatchObject({ published: 1, skipped: 1, failed: 0 });
    expect(calls).toBe(1);
  });

  it('treats an already published batch as completed on a repeated click', async () => {
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId, mode: 'RECONCILE', status: 'READY', scanTrusted: true,
      sourceTotal: 0, businessDate: new Date('2026-10-23T00:00:00Z'), finishedAt: new Date()
    } });
    const batch = await prisma.importBatch.create({ data: {
      sourceId, createdBy: actorId, fileName: 'already.json', format: 'JSON',
      checksum: randomUUID().replaceAll('-', '').padEnd(64, '0'), status: 'PUBLISHED'
    } });
    await prisma.externalSyncRunBatch.create({ data: { runId: run.id, batchId: batch.id, chunkIndex: 1 } });
    const review = new PlayerCatalogReconciliationReview(prisma,
      { requirePlatformAdmin: async () => ({ id: actorId }) } as never, publisher as never);

    expect(await review.publishValid(actorId, run.id)).toMatchObject({ published: 0, skipped: 0, failed: 0 });
    expect(await prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } }))
      .toMatchObject({ currentPhase: 'PUBLISHED' });
  });

  it('publishes one batch per request and repairs a published batch after interruption', async () => {
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId, mode: 'RECONCILE', status: 'READY', scanTrusted: true,
      businessDate: new Date('2026-10-23T00:00:00Z'), finishedAt: new Date()
    } });
    const batches = await Promise.all([1, 2].map((number) => prisma.importBatch.create({ data: {
      sourceId, createdBy: actorId, fileName: `batch-${number}.json`, format: 'JSON',
      checksum: randomUUID().replaceAll('-', '').padEnd(64, '0'), status: 'READY'
    } })));
    await prisma.externalSyncRunBatch.createMany({ data: batches.map((batch, index) => ({
      runId: run.id, batchId: batch.id, chunkIndex: index + 1
    })) });
    let calls = 0;
    const review = new PlayerCatalogReconciliationReview(prisma,
      { requirePlatformAdmin: async () => ({ id: actorId }) } as never,
      { publishForPlatformAdmin: async (_actorId: string, batchId: string) => {
        calls += 1;
        await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'PUBLISHED' } });
        return { status: 'PUBLISHED' };
      } } as never);
    expect(await review.publishValid(actorId, run.id)).toMatchObject({ published: 1, remaining: 1 });
    expect(await review.publishValid(actorId, run.id)).toMatchObject({ published: 1, remaining: 0 });
    expect(calls).toBe(2);
  });

  it('does not claim full alignment when public and source counts match but IDs differ', async () => {
    const source = await prisma.dataSource.create({ data: {
      code: `test-review-${randomUUID()}`, name: 'Review test source', type: 'API'
    } });
    const player = await prisma.footballPlayer.create({ data: { nameEn: 'Review identity test' } });
    const card = await prisma.playerCard.create({ data: {
      sourceId: source.id, externalId: 'local-only', playerId: player.id,
      cardName: 'Local only', position: 'CB', overallRating: 90,
      cardType: 'STANDARD', status: 'ACTIVE', publishedAt: new Date()
    } });
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId: source.id, actorId, mode: 'RECONCILE', status: 'READY',
      scanTrusted: true, sourceTotal: 1, finishedAt: new Date()
    } });
    try {
      await prisma.playerCatalogScanEntry.create({ data: {
        runId: run.id, pass: 2, externalId: 'website-only', summaryChecksum: 'a'.repeat(64)
      } });
      const review = new PlayerCatalogReconciliationReview(prisma,
        { requirePlatformAdmin: async () => ({ id: actorId }) } as never, publisher as never);
      await review.publishValid(actorId, run.id);
      await expect(prisma.externalSyncRun.findUnique({ where: { id: run.id } }))
        .resolves.toMatchObject({ currentPhase: 'PARTIALLY_PUBLISHED' });
    } finally {
      await prisma.externalSyncRun.delete({ where: { id: run.id } });
      await prisma.playerCard.delete({ where: { id: card.id } });
      await prisma.footballPlayer.delete({ where: { id: player.id } });
      await prisma.dataSource.delete({ where: { id: source.id } });
    }
  });
});
