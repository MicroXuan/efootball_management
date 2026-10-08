import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { jest } from '@jest/globals';
import { PrismaService } from '../database/prisma.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { TeamCatalogService } from '../team-catalog/team-catalog.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import { PlatformDataSyncService } from './platform-data-sync.service.js';

config({ path: '../../.env', quiet: true });

describe('PlatformDataSyncService queries', () => {
  const prisma = new PrismaService();
  let adminId = '';
  let sourceId = '';
  let sourceCode = '';
  let runId = '';
  let baselineRunTotal = 0;
  let baselineTeamReview = { pending: 0, failed: 0, published: 0 };
  let baselinePlayerReview = { pending: 0, failed: 0, published: 0 };
  const authorizationCalls: string[] = [];
  const adminAuthorization = { requirePlatformAdmin: async (id: string) => {
    authorizationCalls.push(id);
    return { id };
  } };
  const userAuthorization = { can: async () => true };

  beforeAll(async () => {
    await prisma.$connect();
    const admin = await prisma.adminAccount.create({ data: {
      username: `platform-query-${randomUUID()}`,
      displayName: '数据同步管理员',
      passwordHash: 'unused',
      platformRole: 'PLATFORM_ADMIN'
    } });
    adminId = admin.id;
    sourceCode = `platform-query-${randomUUID()}`;
    const source = await prisma.dataSource.create({ data: {
      code: sourceCode,
      name: 'Platform query source',
      type: 'API'
    } });
    sourceId = source.id;
  });

  beforeEach(async () => {
    authorizationCalls.length = 0;
    baselineRunTotal = await prisma.teamCatalogSyncRun.count();
    const baselineGroups = await prisma.teamCatalogSyncItem.groupBy({
      by: ['reviewStatus'], _count: { _all: true }
    });
    const baselineCounts = new Map(baselineGroups.map((entry) => [entry.reviewStatus, entry._count._all]));
    baselineTeamReview = {
      pending: baselineCounts.get('PENDING') ?? 0,
      failed: baselineCounts.get('FAILED') ?? 0,
      published: baselineCounts.get('PUBLISHED') ?? 0
    };
    const [playerPending, playerFailed, playerPublished] = await Promise.all([
      prisma.importBatch.count({ where: { status: { in: ['READY', 'VALIDATED'] }, syncRunLinks: { some: {} } } }),
      prisma.importBatch.count({ where: { status: 'FAILED', syncRunLinks: { some: {} } } }),
      prisma.importBatch.count({ where: { status: 'PUBLISHED', syncRunLinks: { some: {} } } })
    ]);
    baselinePlayerReview = { pending: playerPending, failed: playerFailed, published: playerPublished };
    const runs = await Promise.all(Array.from({ length: 25 }, (_, index) =>
      prisma.teamCatalogSyncRun.create({ data: {
        actorAdminId: adminId,
        mode: 'INCREMENTAL',
        status: index === 0 ? 'FAILED' : 'READY',
        errorCode: index === 0 ? 'PROCESS_INTERRUPTED' : null,
        currentPhase: index === 0 ? 'INTERRUPTED' : 'READY',
        scannedCount: index === 0 ? 55 : 0,
        createdAt: new Date(Date.UTC(2026, 9, 7, 0, index))
      } })
    ));
    runId = runs[0]!.id;
    await prisma.teamCatalogSyncItem.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        runId,
        sourceExternalId: `team-${String(index + 1).padStart(3, '0')}`,
        summaryChecksum: String(index + 1).padStart(64, '0'),
        detailChecksum: String(index + 101).padStart(64, '0'),
        changeType: index % 3 === 0 ? 'UPDATED' as const : 'ADDED' as const,
        reviewStatus: index % 5 === 0 ? 'FAILED' as const : 'PENDING' as const,
        candidateJson: {
          sourceExternalId: `team-${String(index + 1).padStart(3, '0')}`,
          sourceLeagueExternalId: 'league-1',
          sourceLeagueName: '测试联赛',
          nameZh: `目标队 ${index + 1}`,
          nameEn: null,
          nameJa: null,
          shortName: `T${index + 1}`,
          remoteLogoUrl: null,
          storedLogoUrl: null,
          sourceUpdatedAt: null
        },
        errorCode: index % 5 === 0 ? 'CREST_INVALID' : null,
        errorMessage: index % 5 === 0 ? '队徽无效' : null
      }))
    });
  });

  afterEach(async () => {
    await prisma.teamCatalogSyncRun.deleteMany({ where: { actorAdminId: adminId } });
    await prisma.teamCatalogItem.deleteMany({
      where: { sourceType: 'PESDATA', sourceExternalId: { startsWith: 'platform-mutation-' } }
    });
  });

  afterAll(async () => {
    await prisma.externalSyncRun.deleteMany({ where: { sourceId } });
    await prisma.importBatch.deleteMany({ where: { sourceId } });
    await prisma.dataSource.delete({ where: { id: sourceId } });
    await prisma.auditLog.deleteMany({ where: { actorAdminId: adminId } });
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  function service() {
    const imports = new PlayerImportService(prisma, userAuthorization as never, adminAuthorization as never);
    const audit = new AuditLogService(prisma);
    const catalog = new TeamCatalogService(prisma, audit, new LeagueVisibilityService(prisma));
    return new PlatformDataSyncService(
      prisma,
      adminAuthorization as never,
      imports,
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      audit
    );
  }

  it('paginates large team review results and aggregates error reasons', async () => {
    const result = await service().listTeamItems(adminId, runId, {
      page: 2,
      pageSize: 20,
      status: ['PENDING', 'FAILED']
    });

    expect(result).toMatchObject({ page: 2, pageSize: 20, total: 55 });
    expect(result.items).toHaveLength(20);
    expect(result.summary).toMatchObject({ pending: 44, failed: 11 });
    expect(result.summary.errors).toEqual([{ code: 'CREST_INVALID', count: 11 }]);
    expect(authorizationCalls).toEqual([adminId]);
  });

  it('searches staged names and source ids without changing pagination totals', async () => {
    const byName = await service().listTeamItems(adminId, runId, {
      page: 1, pageSize: 20, query: '目标队 42'
    });
    const bySource = await service().listTeamItems(adminId, runId, {
      page: 1, pageSize: 20, query: 'team-043'
    });
    const wrongLeague = await service().listTeamItems(adminId, runId, {
      page: 1, pageSize: 20, sourceLeagueId: 'another-league'
    });

    expect(byName.total).toBe(1);
    expect(byName.items[0]?.candidate?.nameZh).toBe('目标队 42');
    expect(bySource.total).toBe(1);
    expect(bySource.items[0]?.sourceExternalId).toBe('team-043');
    expect(wrongLeague.total).toBe(0);
  });

  it('rejects unknown filter values instead of silently returning an empty page', async () => {
    await expect(service().listTeamItems(adminId, runId, {
      page: 1, pageSize: 20, status: ['UNKNOWN']
    })).rejects.toMatchObject({ response: { code: 'INVALID_SYNC_FILTER' } });
  });

  it('paginates run history and marks interrupted work resumable', async () => {
    const history = await service().listTeamRuns(adminId, { page: 2, pageSize: 20 });
    const interrupted = await service().getTeamRun(adminId, runId);

    expect(history).toMatchObject({ page: 2, pageSize: 20, total: baselineRunTotal + 25 });
    expect(history.items).toHaveLength(Math.min(20, Math.max(0, baselineRunTotal + 25 - 20)));
    expect(interrupted).toMatchObject({ errorCode: 'PROCESS_INTERRUPTED', resumable: true });
  });

  it('searches player review records by normalized player name on the server', async () => {
    const imports = new PlayerImportService(prisma, userAuthorization as never, adminAuthorization as never);
    const outcome = await imports.createBatchForPlatformAdmin(adminId, {
      sourceCode,
      fileName: `player-search-${randomUUID()}.json`,
      format: 'JSON',
      content: JSON.stringify(Array.from({ length: 25 }, (_, index) => ({
        externalId: `search-card-${index + 1}`,
        playerNameZh: `检索球员 ${index + 1}`,
        cardName: '精选',
        position: 'CMF',
        overallRating: 90,
        cardType: 'FEATURED',
        skills: [],
        attributes: {}
      })))
    });

    const result = await service().listPlayerRecords(adminId, outcome.batch.id, {
      page: 1,
      pageSize: 20,
      query: '检索球员 22'
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.normalized?.playerNameZh).toBe('检索球员 22');
  });

  it('returns an overview without exposing non-platform data', async () => {
    const overview = await service().getOverview(adminId);

    expect(overview.teams).toMatchObject({
      pendingReview: baselineTeamReview.pending + 44,
      failedReview: baselineTeamReview.failed + 11,
      published: baselineTeamReview.published
    });
    expect(overview.players).toMatchObject({
      pendingReview: baselinePlayerReview.pending,
      failedReview: baselinePlayerReview.failed,
      published: baselinePlayerReview.published
    });
  });

  it('reports partial team publish failures and keeps repeated publication idempotent', async () => {
    const mutationRun = await prisma.teamCatalogSyncRun.create({ data: {
      actorAdminId: adminId, mode: 'INCREMENTAL', status: 'READY'
    } });
    const pendingExternalId = `platform-mutation-${randomUUID()}`;
    const staleExternalId = `platform-mutation-${randomUUID()}`;
    const [pending, stale] = await Promise.all([
      prisma.teamCatalogSyncItem.create({ data: {
        runId: mutationRun.id,
        sourceExternalId: pendingExternalId,
        summaryChecksum: '1'.repeat(64),
        detailChecksum: '2'.repeat(64),
        changeType: 'ADDED',
        reviewStatus: 'PENDING',
        candidateJson: {
          sourceExternalId: pendingExternalId,
          sourceLeagueExternalId: 'league-1', sourceLeagueName: '测试联赛',
          nameZh: '待发布队壳', nameEn: null, nameJa: null, shortName: 'PUB',
          remoteLogoUrl: null, storedLogoUrl: 'https://media.example.com/team.webp', sourceUpdatedAt: null
        }
      } }),
      prisma.teamCatalogSyncItem.create({ data: {
        runId: mutationRun.id,
        sourceExternalId: staleExternalId,
        summaryChecksum: '3'.repeat(64), detailChecksum: null,
        changeType: 'ADDED', reviewStatus: 'FAILED',
        errorCode: 'CREST_INVALID', errorMessage: '队徽无效'
      } })
    ]);
    const missingId = randomUUID();

    const first = await service().publishTeamItems(adminId, [pending.id, stale.id, missingId]);
    const second = await service().publishTeamItems(adminId, [pending.id]);

    expect(first.requestedCount).toBe(3);
    expect(first.succeededIds).toEqual([pending.id]);
    expect(first.failed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: stale.id, code: 'TEAM_SYNC_ITEM_NOT_PENDING' }),
      expect.objectContaining({ id: missingId, code: 'TEAM_SYNC_ITEM_NOT_FOUND' })
    ]));
    expect(second).toMatchObject({ requestedCount: 1, succeededIds: [pending.id], failed: [] });
    expect(await prisma.teamCatalogItem.count({
      where: { sourceType: 'PESDATA', sourceExternalId: pending.sourceExternalId }
    })).toBe(1);
    const operation = await prisma.auditLog.findFirstOrThrow({
      where: { actorAdminId: adminId, action: 'BATCH_PUBLISH_TEAM_SHELLS' },
      orderBy: { createdAt: 'asc' }
    });
    expect(operation.metadata).toMatchObject({
      status: 'COMPLETED', requestedCount: 3, succeededCount: 1, failedCount: 2,
      failures: expect.arrayContaining([
        expect.objectContaining({ id: stale.id, code: 'TEAM_SYNC_ITEM_NOT_PENDING' }),
        expect.objectContaining({ id: missingId, code: 'TEAM_SYNC_ITEM_NOT_FOUND' })
      ])
    });
  });

  it('serializes concurrent publication of the same team shell', async () => {
    const mutationRun = await prisma.teamCatalogSyncRun.create({ data: {
      actorAdminId: adminId, mode: 'INCREMENTAL', status: 'READY'
    } });
    const externalId = `platform-mutation-${randomUUID()}`;
    const item = await prisma.teamCatalogSyncItem.create({ data: {
      runId: mutationRun.id,
      sourceExternalId: externalId,
      summaryChecksum: '4'.repeat(64), detailChecksum: '5'.repeat(64),
      changeType: 'ADDED', reviewStatus: 'PENDING',
      candidateJson: {
        sourceExternalId: externalId,
        sourceLeagueExternalId: 'league-1', sourceLeagueName: '测试联赛',
        nameZh: '并发发布队壳', nameEn: null, nameJa: null, shortName: 'LOCK',
        remoteLogoUrl: null, storedLogoUrl: 'https://media.example.com/concurrent.webp', sourceUpdatedAt: null
      }
    } });

    const [left, right] = await Promise.all([
      service().publishTeamItems(adminId, [item.id]),
      service().publishTeamItems(adminId, [item.id])
    ]);

    expect(left.failed).toEqual([]);
    expect(right.failed).toEqual([]);
    expect(await prisma.teamCatalogItem.count({
      where: { sourceType: 'PESDATA', sourceExternalId: externalId }
    })).toBe(1);
  });
});

describe('PlatformDataSyncService mutations', () => {
  const adminId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const batchId = '33333333-3333-4333-8333-333333333333';

  function fixture(audit?: { record: jest.Mock; updateMetadata: jest.Mock }) {
    const requirePlatformAdmin = jest.fn(async () => ({ id: adminId }));
    const cancelBatchForPlatformAdmin = jest.fn(async () => ({ id: batchId, status: 'CANCELLED' }));
    const publishForPlatformAdmin = jest.fn(async () => ({
      id: batchId, status: 'PUBLISHED', createCount: 2, updateCount: 1
    }));
    const createPlayerRun = jest.fn(async () => ({ runId, status: 'PENDING' as const }));
    const createTeamRun = jest.fn(async () => ({ runId, status: 'PENDING' as const }));
    const retryPlatformItems = jest.fn(async (_actor: string, ids: string[]) => ({
      requestedCount: ids.length, succeededIds: ids, failed: []
    }));
    const schedulePlayer = jest.fn();
    const scheduleTeam = jest.fn();
    const service = new PlatformDataSyncService(
      {} as never,
      { requirePlatformAdmin } as never,
      { cancelBatchForPlatformAdmin } as never,
      {} as never,
      { publishForPlatformAdmin } as never,
      { createPlatformRun: createPlayerRun } as never,
      { createPlatformRun: createTeamRun, retryPlatformItems } as never,
      { schedulePlayer, scheduleTeam } as never,
      audit as never
    );
    return {
      service, createPlayerRun, createTeamRun, schedulePlayer, scheduleTeam,
      publishForPlatformAdmin, cancelBatchForPlatformAdmin, retryPlatformItems
    };
  }

  it('queues browser syncs with the exact mode and schedules background execution', async () => {
    const value = fixture();

    await expect(value.service.startPlayerRun(adminId, { mode: 'incremental' })).resolves.toEqual({ runId, status: 'PENDING' });
    await expect(value.service.startTeamRun(adminId, { mode: 'full' })).resolves.toEqual({ runId, status: 'PENDING' });

    expect(value.createPlayerRun).toHaveBeenCalledWith(adminId, { mode: 'incremental' });
    expect(value.createTeamRun).toHaveBeenCalledWith(adminId, { mode: 'full' });
    expect(value.schedulePlayer).toHaveBeenCalledWith(runId);
    expect(value.scheduleTeam).toHaveBeenCalledWith(runId);
  });

  it('delegates whole player batches and team retries to their transactional domain services', async () => {
    const value = fixture();
    const itemId = '44444444-4444-4444-8444-444444444444';

    await value.service.publishPlayerBatch(adminId, batchId);
    await value.service.rejectPlayerBatch(adminId, batchId);
    await expect(value.service.retryTeamItems(adminId, [itemId])).resolves.toMatchObject({
      requestedCount: 1, succeededIds: [itemId], failed: []
    });

    expect(value.publishForPlatformAdmin).toHaveBeenCalledWith(adminId, batchId);
    expect(value.cancelBatchForPlatformAdmin).toHaveBeenCalledWith(adminId, batchId);
    expect(value.retryPlatformItems).toHaveBeenCalledWith(adminId, [itemId]);
  });

  it('retries a transient batch-audit finalization failure before returning success', async () => {
    const updateMetadata = jest.fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('temporary audit failure'))
      .mockResolvedValueOnce({ id: 'audit-1' });
    const audit = {
      record: jest.fn(async () => ({ id: 'audit-1' })),
      updateMetadata
    };
    const value = fixture(audit);
    const itemId = '55555555-5555-4555-8555-555555555555';

    await expect(value.service.retryTeamItems(adminId, [itemId])).resolves.toMatchObject({
      requestedCount: 1, succeededIds: [itemId], failed: []
    });

    expect(updateMetadata).toHaveBeenCalledTimes(2);
    expect(updateMetadata).toHaveBeenLastCalledWith(
      expect.anything(),
      'audit-1',
      expect.objectContaining({ status: 'COMPLETED', requestedCount: 1, succeededCount: 1, failedCount: 0 })
    );
  });
});
