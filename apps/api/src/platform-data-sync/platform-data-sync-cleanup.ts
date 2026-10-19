import { PrismaService } from '../database/prisma.service.js';

export type PlatformSyncCleanupCounts = {
  playerRuns: number;
  playerItems: number;
  playerBatchLinks: number;
  teamRuns: number;
  teamItems: number;
  deletableBatches: number;
  deletableRecords: number;
  publishedLinkedBatches: number;
};

export type PlatformSyncCleanupResult = {
  before: PlatformSyncCleanupCounts;
  after: PlatformSyncCleanupCounts;
};

export async function inspectPlatformSyncCleanup(
  prisma: PrismaService,
): Promise<PlatformSyncCleanupCounts> {
  const linkedBatchWhere = { syncRunLinks: { some: {} } } as const;
  const deletableBatchWhere = {
    ...linkedBatchWhere,
    status: { not: 'PUBLISHED' as const },
  };

  const [
    playerRuns,
    playerItems,
    playerBatchLinks,
    teamRuns,
    teamItems,
    deletableBatches,
    deletableRecords,
    publishedLinkedBatches,
  ] = await Promise.all([
    prisma.externalSyncRun.count(),
    prisma.externalSyncItem.count(),
    prisma.externalSyncRunBatch.count(),
    prisma.teamCatalogSyncRun.count(),
    prisma.teamCatalogSyncItem.count(),
    prisma.importBatch.count({ where: deletableBatchWhere }),
    prisma.importRecord.count({ where: { batch: deletableBatchWhere } }),
    prisma.importBatch.count({
      where: { ...linkedBatchWhere, status: 'PUBLISHED' },
    }),
  ]);

  return {
    playerRuns,
    playerItems,
    playerBatchLinks,
    teamRuns,
    teamItems,
    deletableBatches,
    deletableRecords,
    publishedLinkedBatches,
  };
}

export async function clearPlatformSyncData(
  prisma: PrismaService,
): Promise<PlatformSyncCleanupResult> {
  const before = await inspectPlatformSyncCleanup(prisma);

  await prisma.$transaction(
    async (tx) => {
      const deletableBatches = await tx.importBatch.findMany({
        where: {
          syncRunLinks: { some: {} },
          status: { not: 'PUBLISHED' },
        },
        select: { id: true },
      });
      const deletableBatchIds = deletableBatches.map(({ id }) => id);

      await tx.externalSyncRunBatch.deleteMany();
      await tx.externalSyncRun.deleteMany();
      await tx.teamCatalogSyncRun.deleteMany();

      if (deletableBatchIds.length > 0) {
        await tx.importBatch.deleteMany({
          where: { id: { in: deletableBatchIds }, status: { not: 'PUBLISHED' } },
        });
      }
    },
    { timeout: 20_000 },
  );

  const after = await inspectPlatformSyncCleanup(prisma);
  return { before, after };
}
