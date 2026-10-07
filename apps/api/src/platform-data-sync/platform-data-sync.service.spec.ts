import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { TeamCatalogService } from '../team-catalog/team-catalog.service.js';
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
  });

  afterAll(async () => {
    await prisma.externalSyncRun.deleteMany({ where: { sourceId } });
    await prisma.importBatch.deleteMany({ where: { sourceId } });
    await prisma.dataSource.delete({ where: { id: sourceId } });
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  function service() {
    const imports = new PlayerImportService(prisma, userAuthorization as never, adminAuthorization as never);
    const catalog = new TeamCatalogService(prisma, new AuditLogService(prisma));
    return new PlatformDataSyncService(prisma, adminAuthorization as never, imports, catalog);
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
});
