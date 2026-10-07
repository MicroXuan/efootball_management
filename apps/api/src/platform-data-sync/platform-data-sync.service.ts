import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ImportBatchSchema,
  PlatformDataSyncOverviewSchema,
  PlatformSyncRunPageSchema,
  PlatformSyncRunSummarySchema,
  PlayerSyncBatchPageSchema,
  type PlatformDataSyncOverview,
  type PlatformPageRequest,
  type PlatformSyncRunPage,
  type PlatformSyncRunSummary,
  type PlayerImportRecordPage,
  type PlayerSyncBatchPage,
  type TeamSyncItemPage
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ExternalSyncRun, TeamCatalogSyncRun } from '../generated/prisma/client.js';
import type { ExternalSyncStatus, ImportBatchStatus, TeamCatalogSyncStatus } from '../generated/prisma/enums.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import { TeamCatalogService } from '../team-catalog/team-catalog.service.js';

type PlayerRunWithCount = ExternalSyncRun & { _count: { batchLinks: number } };

@Injectable()
export class PlatformDataSyncService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(PlayerImportService) private readonly imports: PlayerImportService,
    @Inject(TeamCatalogService) private readonly catalog: TeamCatalogService
  ) {}

  async getOverview(adminId: string): Promise<PlatformDataSyncOverview> {
    await this.authorization.requirePlatformAdmin(adminId);
    const [playerActive, teamActive, playerPending, playerFailed, playerPublished, teamGroups, playerLast, teamLast] =
      await Promise.all([
        this.prisma.externalSyncRun.findFirst({
          where: { status: { in: ['PENDING', 'RUNNING'] } },
          include: { _count: { select: { batchLinks: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        }),
        this.prisma.teamCatalogSyncRun.findFirst({
          where: { status: { in: ['PENDING', 'RUNNING'] } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        }),
        this.prisma.importBatch.count({ where: { status: { in: ['READY', 'VALIDATED'] }, syncRunLinks: { some: {} } } }),
        this.prisma.importBatch.count({ where: { status: 'FAILED', syncRunLinks: { some: {} } } }),
        this.prisma.importBatch.count({ where: { status: 'PUBLISHED', syncRunLinks: { some: {} } } }),
        this.prisma.teamCatalogSyncItem.groupBy({
          by: ['reviewStatus'], orderBy: { reviewStatus: 'asc' }, _count: { reviewStatus: true }
        }),
        this.prisma.externalSyncRun.findFirst({
          where: { status: { in: ['READY', 'FAILED'] } }, orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }]
        }),
        this.prisma.teamCatalogSyncRun.findFirst({
          where: { status: { in: ['READY', 'FAILED'] } }, orderBy: [{ completedAt: 'desc' }, { id: 'desc' }]
        })
      ]);
    const teamCounts = new Map(teamGroups.map((entry) => [entry.reviewStatus, entry._count.reviewStatus]));
    return PlatformDataSyncOverviewSchema.parse({
      players: {
        activeRun: playerActive ? this.playerRun(playerActive) : null,
        pendingReview: playerPending,
        failedReview: playerFailed,
        published: playerPublished,
        lastCompletedAt: playerLast?.finishedAt?.toISOString() ?? null
      },
      teams: {
        activeRun: teamActive ? this.teamRun(teamActive) : null,
        pendingReview: teamCounts.get('PENDING') ?? 0,
        failedReview: teamCounts.get('FAILED') ?? 0,
        published: teamCounts.get('PUBLISHED') ?? 0,
        lastCompletedAt: teamLast?.completedAt?.toISOString() ?? null
      }
    });
  }

  async listPlayerRuns(adminId: string, query: PlatformPageRequest): Promise<PlatformSyncRunPage> {
    await this.authorization.requirePlatformAdmin(adminId);
    const statuses = this.playerStatuses(query.status);
    const where = statuses ? { status: { in: statuses } } : {};
    const [runs, total, groups] = await Promise.all([
      this.prisma.externalSyncRun.findMany({
        where,
        include: { _count: { select: { batchLinks: true } } },
        orderBy: [{ createdAt: query.sortOrder ?? 'desc' }, { id: query.sortOrder ?? 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.externalSyncRun.count({ where }),
      this.prisma.externalSyncRun.groupBy({
        by: ['status'], orderBy: { status: 'asc' }, _count: { status: true }
      })
    ]);
    return PlatformSyncRunPageSchema.parse({
      items: runs.map((run) => this.playerRun(run)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      summary: this.runStatusSummary(groups.map((entry) => [entry.status, entry._count.status]))
    });
  }

  async getPlayerRun(adminId: string, runId: string): Promise<PlatformSyncRunSummary> {
    await this.authorization.requirePlatformAdmin(adminId);
    const run = await this.prisma.externalSyncRun.findUnique({
      where: { id: runId }, include: { _count: { select: { batchLinks: true } } }
    });
    if (!run) throw new NotFoundException({ code: 'PESDATA_RUN_NOT_FOUND' });
    return this.playerRun(run);
  }

  async listPlayerBatches(adminId: string, runId: string, query: PlatformPageRequest): Promise<PlayerSyncBatchPage> {
    await this.authorization.requirePlatformAdmin(adminId);
    const statuses = this.batchStatuses(query.status) ?? ['READY', 'VALIDATED', 'FAILED'];
    const where = {
      syncRunLinks: { some: { runId } },
      status: { in: statuses },
      ...(query.query ? { OR: [{ fileName: { contains: query.query } }, { id: { contains: query.query } }] } : {})
    };
    const [batches, total, groups] = await Promise.all([
      this.prisma.importBatch.findMany({
        where,
        include: { source: true, release: true },
        orderBy: [{ createdAt: query.sortOrder ?? 'desc' }, { id: query.sortOrder ?? 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.importBatch.count({ where }),
      this.prisma.importBatch.groupBy({
        by: ['status'], where: { syncRunLinks: { some: { runId } } }, orderBy: { status: 'asc' }, _count: { status: true }
      })
    ]);
    const counts = new Map(groups.map((entry) => [entry.status, entry._count.status]));
    return PlayerSyncBatchPageSchema.parse({
      items: batches.map((batch) => ImportBatchSchema.parse({
        id: batch.id,
        sourceCode: batch.source.code,
        fileName: batch.fileName,
        format: batch.format,
        checksum: batch.checksum,
        status: batch.status,
        totalCount: batch.totalCount,
        createCount: batch.createCount,
        updateCount: batch.updateCount,
        unchangedCount: batch.unchangedCount,
        invalidCount: batch.invalidCount,
        failureReason: batch.failureReason,
        releaseId: batch.release?.id ?? null,
        releaseSequence: batch.release?.sequence ?? null,
        createdBy: batch.createdBy,
        createdAt: batch.createdAt.toISOString(),
        publishedAt: batch.publishedAt?.toISOString() ?? null
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      summary: {
        uploaded: counts.get('UPLOADED') ?? 0,
        validated: counts.get('VALIDATED') ?? 0,
        ready: counts.get('READY') ?? 0,
        published: counts.get('PUBLISHED') ?? 0,
        failed: counts.get('FAILED') ?? 0,
        cancelled: counts.get('CANCELLED') ?? 0
      }
    });
  }

  async listPlayerRecords(
    adminId: string,
    batchId: string,
    query: PlatformPageRequest & { diffType?: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'INVALID' }
  ): Promise<PlayerImportRecordPage> {
    await this.authorization.requirePlatformAdmin(adminId);
    return this.imports.listRecordsForPlatformAdmin(adminId, batchId, {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.query ? { query: query.query } : {}),
      ...(query.diffType ? { diffType: query.diffType } : {})
    });
  }

  async listTeamRuns(adminId: string, query: PlatformPageRequest): Promise<PlatformSyncRunPage> {
    await this.authorization.requirePlatformAdmin(adminId);
    const statuses = this.teamStatuses(query.status);
    const where = statuses ? { status: { in: statuses } } : {};
    const [runs, total, groups] = await Promise.all([
      this.prisma.teamCatalogSyncRun.findMany({
        where,
        orderBy: [{ createdAt: query.sortOrder ?? 'desc' }, { id: query.sortOrder ?? 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.teamCatalogSyncRun.count({ where }),
      this.prisma.teamCatalogSyncRun.groupBy({
        by: ['status'], orderBy: { status: 'asc' }, _count: { status: true }
      })
    ]);
    return PlatformSyncRunPageSchema.parse({
      items: runs.map((run) => this.teamRun(run)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      summary: this.runStatusSummary(groups.map((entry) => [entry.status, entry._count.status]))
    });
  }

  async getTeamRun(adminId: string, runId: string): Promise<PlatformSyncRunSummary> {
    await this.authorization.requirePlatformAdmin(adminId);
    const run = await this.prisma.teamCatalogSyncRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException({ code: 'PESDATA_TEAM_RUN_NOT_FOUND' });
    return this.teamRun(run);
  }

  async listTeamItems(
    adminId: string,
    runId: string,
    query: PlatformPageRequest
  ): Promise<TeamSyncItemPage> {
    await this.authorization.requirePlatformAdmin(adminId);
    return this.catalog.listSyncDifferencesPage(runId, query);
  }

  private playerRun(run: PlayerRunWithCount): PlatformSyncRunSummary {
    return PlatformSyncRunSummarySchema.parse({
      id: run.id,
      kind: 'PLAYER_CARDS',
      mode: run.mode,
      status: run.status,
      actorAdminId: run.actorId,
      currentPhase: run.currentPhase,
      heartbeatAt: run.heartbeatAt?.toISOString() ?? null,
      leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
      resumable: run.status === 'FAILED' && run.activeLeaseKey === null,
      counters: {
        sourceTotal: run.sourceTotal,
        scanned: run.scannedCount,
        fetched: run.fetchedCount,
        skipped: run.skippedCount,
        added: 0,
        updated: 0,
        missing: 0,
        failed: run.failedCount,
        batches: run._count.batchLinks
      },
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.finishedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString()
    });
  }

  private teamRun(run: TeamCatalogSyncRun): PlatformSyncRunSummary {
    return PlatformSyncRunSummarySchema.parse({
      id: run.id,
      kind: 'TEAM_SHELLS',
      mode: run.mode,
      status: run.status,
      actorAdminId: run.actorAdminId,
      currentPhase: run.currentPhase,
      heartbeatAt: run.heartbeatAt?.toISOString() ?? null,
      leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
      resumable: run.status === 'FAILED' && run.activeLeaseKey === null,
      counters: {
        sourceTotal: null,
        scanned: run.scannedCount,
        fetched: 0,
        skipped: 0,
        added: run.addedCount,
        updated: run.updatedCount,
        missing: run.missingCount,
        failed: run.failedCount,
        batches: 0
      },
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString()
    });
  }

  private runStatusSummary(entries: Array<[string, number]>) {
    const counts = new Map(entries);
    return {
      pending: counts.get('PENDING') ?? 0,
      running: counts.get('RUNNING') ?? 0,
      ready: counts.get('READY') ?? 0,
      paused: counts.get('PAUSED') ?? 0,
      failed: counts.get('FAILED') ?? 0
    };
  }

  private playerStatuses(values?: string[]): ExternalSyncStatus[] | undefined {
    return this.enumValues(values, ['PENDING', 'RUNNING', 'READY', 'PAUSED', 'FAILED']);
  }

  private teamStatuses(values?: string[]): TeamCatalogSyncStatus[] | undefined {
    return this.enumValues(values, ['PENDING', 'RUNNING', 'READY', 'FAILED']);
  }

  private batchStatuses(values?: string[]): ImportBatchStatus[] | undefined {
    return this.enumValues(values, ['UPLOADED', 'VALIDATED', 'READY', 'PUBLISHED', 'FAILED', 'CANCELLED']);
  }

  private enumValues<T extends string>(values: string[] | undefined, allowed: readonly T[]): T[] | undefined {
    if (!values?.length) return undefined;
    const set = new Set(allowed);
    const accepted = values.filter((value): value is T => set.has(value as T));
    if (accepted.length !== values.length) {
      throw new BadRequestException({ code: 'INVALID_SYNC_FILTER', message: 'Unknown synchronization filter value' });
    }
    return accepted;
  }
}
