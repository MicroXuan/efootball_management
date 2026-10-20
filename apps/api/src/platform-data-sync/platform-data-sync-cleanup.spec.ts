import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { clearPlatformSyncData } from './platform-data-sync-cleanup.js';

config({ path: '../../.env', quiet: true });

const isIsolatedTestDatabase = process.env.RUN_DESTRUCTIVE_SYNC_CLEANUP_TEST === '1';

(isIsolatedTestDatabase ? describe : describe.skip)('platform sync data cleanup', () => {
  const prisma = new PrismaService();
  let adminId = '';
  let sourceId = '';
  let publishedBatchId = '';
  let releaseId = '';
  let catalogId = '';
  let auditId = '';

  beforeAll(async () => {
    await prisma.$connect();
    const admin = await prisma.adminAccount.create({ data: {
      username: `cleanup-${randomUUID()}`, displayName: '清理测试', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
    } });
    adminId = admin.id;
    const source = await prisma.dataSource.create({ data: {
      code: `cleanup-${randomUUID()}`, name: 'Cleanup source', type: 'API'
    } });
    sourceId = source.id;
  });

  afterAll(async () => {
    if (releaseId) await prisma.catalogRelease.deleteMany({ where: { id: releaseId } });
    if (publishedBatchId) await prisma.importBatch.deleteMany({ where: { id: publishedBatchId } });
    if (catalogId) await prisma.teamCatalogItem.deleteMany({ where: { id: catalogId } });
    if (auditId) await prisma.auditLog.deleteMany({ where: { id: auditId } });
    await prisma.dataSource.deleteMany({ where: { id: sourceId } });
    await prisma.adminAccount.deleteMany({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it('clears recoverable synchronization state and preserves published business data', async () => {
    const playerRun = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId: adminId, mode: 'SAMPLE', status: 'PAUSED'
    } });
    const teamRun = await prisma.teamCatalogSyncRun.create({ data: {
      actorAdminId: adminId, mode: 'SAMPLE', status: 'PAUSED'
    } });
    await prisma.externalSyncItem.create({ data: {
      runId: playerRun.id, externalId: 'cleanup-player', summaryChecksum: '1'.repeat(64), status: 'FETCHED'
    } });
    await prisma.teamCatalogSyncItem.create({ data: {
      runId: teamRun.id, sourceExternalId: 'cleanup-team', summaryChecksum: '2'.repeat(64), changeType: 'ADDED'
    } });
    const [published, ready] = await Promise.all([
      prisma.importBatch.create({ data: {
        sourceId, fileName: 'published.json', format: 'JSON', checksum: '3'.repeat(64), status: 'PUBLISHED',
        totalCount: 1, createCount: 1, createdBy: adminId,
        records: { create: { rowNumber: 1, externalId: 'published', rawJson: {}, normalizedJson: {}, diffType: 'CREATE', fieldDiff: {}, validationErrors: {} } }
      } }),
      prisma.importBatch.create({ data: {
        sourceId, fileName: 'ready.json', format: 'JSON', checksum: '4'.repeat(64), status: 'READY',
        totalCount: 1, createCount: 1, createdBy: adminId,
        records: { create: { rowNumber: 1, externalId: 'ready', rawJson: {}, normalizedJson: {}, diffType: 'CREATE', fieldDiff: {}, validationErrors: {} } }
      } })
    ]);
    publishedBatchId = published.id;
    const release = await prisma.catalogRelease.create({ data: {
      batchId: published.id, publishedBy: adminId, createdCount: 1, updatedCount: 0, unchangedCount: 0
    } });
    releaseId = release.id;
    await prisma.externalSyncRunBatch.createMany({ data: [
      { runId: playerRun.id, batchId: published.id, chunkIndex: 1 },
      { runId: playerRun.id, batchId: ready.id, chunkIndex: 2 }
    ] });
    const catalog = await prisma.teamCatalogItem.create({ data: {
      sourceType: 'CUSTOM', nameZh: '保留目录球队', shortName: 'KEEP', status: 'ACTIVE'
    } });
    catalogId = catalog.id;
    const audit = await prisma.auditLog.create({ data: {
      actorAdminId: adminId, action: 'CLEANUP_TEST', resourceType: 'ExternalSyncRun', metadata: {}
    } });
    auditId = audit.id;

    const result = await clearPlatformSyncData(prisma);

    expect(result.after).toMatchObject({
      playerRuns: 0, playerItems: 0, playerBatchLinks: 0, teamRuns: 0, teamItems: 0, deletableBatches: 0
    });
    await expect(prisma.importBatch.findUnique({ where: { id: ready.id } })).resolves.toBeNull();
    await expect(prisma.importBatch.findUnique({ where: { id: published.id } })).resolves.toMatchObject({ status: 'PUBLISHED' });
    await expect(prisma.catalogRelease.count({ where: { id: release.id } })).resolves.toBe(1);
    await expect(prisma.teamCatalogItem.count({ where: { id: catalog.id } })).resolves.toBe(1);
    await expect(prisma.auditLog.count({ where: { id: audit.id } })).resolves.toBe(1);
  }, 20_000);
});
