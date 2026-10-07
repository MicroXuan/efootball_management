import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { ExternalSyncMode } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import type { RawImportRow } from '../player-import/import-adapter.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import { PesdataClient, PesdataClientError } from './pesdata-client.js';
import { mapPesdataPlayer, pesdataValueChecksum, PesdataMappingError } from './pesdata-mapper.js';
import type { PesdataPlayerDetail, PesdataPlayerSummary } from './pesdata.schemas.js';
import { SYNC_HEARTBEAT_INTERVAL_MS, SYNC_LEASE_MS } from '../platform-data-sync/platform-data-sync.constants.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import {
  PesdataSyncError,
  type PesdataSyncMode,
  type PesdataSyncResult,
  type StartPesdataSyncInput
} from './pesdata-sync.types.js';

const IMPORT_CHUNK_SIZE = 5_000;

type SyncCounters = {
  sourceTotal: number | null;
  scannedCount: number;
  fetchedCount: number;
  skippedCount: number;
  failedCount: number;
};

type ServiceOptions = { pageSize?: number; heartbeatIntervalMs?: number };
export const PESDATA_SYNC_OPTIONS = Symbol('PESDATA_SYNC_OPTIONS');

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function databaseMode(mode: PesdataSyncMode): ExternalSyncMode {
  return mode.toUpperCase() as ExternalSyncMode;
}

function externalIdOf(summary: PesdataPlayerSummary): string {
  const value = String(summary.playerId).trim();
  if (!value) throw new PesdataMappingError('playerId');
  return value;
}

export function comparePesdataExternalIds(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const normalizedLeft = left.replace(/^0+(?=\d)/, '');
    const normalizedRight = right.replace(/^0+(?=\d)/, '');
    if (normalizedLeft.length !== normalizedRight.length) {
      return normalizedLeft.length - normalizedRight.length;
    }
    const numericOrder = normalizedLeft.localeCompare(normalizedRight);
    if (numericOrder !== 0) return numericOrder;
  }
  return left.localeCompare(right);
}

@Injectable()
export class PesdataSyncService {
  private readonly pageSize: number;
  private readonly heartbeatIntervalMs: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerImportService) private readonly importService: PlayerImportService,
    @Inject(PesdataClient) private readonly client: PesdataClient,
    @Optional() @Inject(PESDATA_SYNC_OPTIONS) options: ServiceOptions = {},
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService
  ) {
    this.pageSize = options.pageSize ?? 100;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? SYNC_HEARTBEAT_INTERVAL_MS;
  }

  async createPlatformRun(
    actorAdminId: string,
    input: StartPesdataSyncInput
  ): Promise<{ runId: string; status: 'PENDING' }> {
    if (input.dryRun) {
      throw new PesdataSyncError('PESDATA_DRY_RUN_UNSUPPORTED', 'Browser synchronization cannot be a dry run');
    }
    const limit = input.mode === 'sample' ? (input.limit ?? 100) : input.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new PesdataSyncError('PESDATA_LIMIT_INVALID', 'Sync limit must be a positive integer');
    }
    const source = await this.prisma.dataSource.findUnique({ where: { code: 'pesdata' } });
    if (!source?.isEnabled) {
      throw new PesdataSyncError('PESDATA_SOURCE_UNAVAILABLE', 'PESDATA source is missing or disabled');
    }
    const now = new Date();
    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.externalSyncRun.create({ data: {
          sourceId: source.id,
          actorId: actorAdminId,
          mode: databaseMode(input.mode),
          status: 'PENDING',
          activeLeaseKey: 'pesdata',
          requestedLimit: limit ?? null,
          currentPhase: 'QUEUED',
          heartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS)
        } });
        if (this.audit) await this.audit.record(tx, {
          actorAdminId,
          action: `START_PLAYER_CARD_${input.mode.toUpperCase()}_SYNC`,
          resourceType: 'ExternalSyncRun',
          resourceId: created.id,
          metadata: { mode: input.mode, limit: limit ?? null }
        });
        return created;
      });
      return { runId: run.id, status: 'PENDING' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'A PESDATA synchronization is already running');
      }
      throw error;
    }
  }

  async resumePlatformRun(
    _actorAdminId: string,
    runId: string
  ): Promise<{ runId: string; status: 'PENDING' }> {
    const run = await this.prisma.externalSyncRun.findUnique({ where: { id: runId } });
    if (!run) throw new PesdataSyncError('PESDATA_RUN_NOT_FOUND', 'Synchronization run was not found');
    if (run.status === 'READY') throw new PesdataSyncError('PESDATA_RUN_ALREADY_READY', 'Synchronization run is already ready');
    if (run.status !== 'FAILED' || run.activeLeaseKey || run.leaseOwnerToken) {
      throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'Only a failed, inactive synchronization run can be resumed');
    }
    const now = new Date();
    try {
      const resumed = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.externalSyncRun.updateMany({ where: {
          id: runId, status: 'FAILED', activeLeaseKey: null, leaseOwnerToken: null
        }, data: {
          status: 'PENDING',
          activeLeaseKey: 'pesdata',
          currentPhase: 'QUEUED',
          heartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS),
          errorCode: null,
          errorMessage: null,
          finishedAt: null
        } });
        if (changed.count === 1 && this.audit) await this.audit.record(tx, {
          actorAdminId: _actorAdminId,
          action: 'RESUME_PLAYER_CARD_SYNC',
          resourceType: 'ExternalSyncRun',
          resourceId: runId,
          metadata: { runId }
        });
        return changed;
      });
      if (resumed.count !== 1) {
        throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'Synchronization run state changed while resuming');
      }
      return { runId, status: 'PENDING' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'A PESDATA synchronization is already running');
      }
      throw error;
    }
  }

  async executePlatformRun(runId: string): Promise<PesdataSyncResult> {
    const run = await this.prisma.externalSyncRun.findUnique({
      where: { id: runId },
      include: { items: { orderBy: { createdAt: 'asc' } }, batchLinks: { orderBy: { chunkIndex: 'asc' } } }
    });
    if (!run) throw new PesdataSyncError('PESDATA_RUN_NOT_FOUND', 'Synchronization run was not found');
    if (run.status === 'READY') {
      return {
        runId, status: 'READY', sourceTotal: run.sourceTotal, scannedCount: run.scannedCount,
        fetchedCount: run.fetchedCount, skippedCount: run.skippedCount, failedCount: run.failedCount,
        batchIds: run.batchLinks.map(({ batchId }) => batchId), dryRun: false
      };
    }
    if (run.status !== 'PENDING' || run.activeLeaseKey !== 'pesdata') {
      throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'This synchronization run is not queued');
    }
    const now = new Date();
    const leaseOwnerToken = randomUUID();
    const claimed = await this.prisma.externalSyncRun.updateMany({ where: {
      id: runId, status: 'PENDING', activeLeaseKey: 'pesdata', leaseOwnerToken: null
    }, data: {
      status: 'RUNNING', currentPhase: 'FETCHING', startedAt: run.startedAt ?? now,
      leaseOwnerToken, heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS)
    } });
    if (claimed.count !== 1) {
      throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'Synchronization run was claimed by another worker');
    }
    try {
      return await this.withLeaseHeartbeat(runId, leaseOwnerToken, async (assertLeaseHealthy) => {
      const rows: RawImportRow[] = [];
      const seenExternalIds = new Set<string>();
      let fetchedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      for (const item of run.items) {
        seenExternalIds.add(item.externalId);
        if ((item.status === 'FETCHED' || item.status === 'SKIPPED') && item.normalizedJson) {
          rows.push(item.normalizedJson as RawImportRow);
          if (item.status === 'FETCHED') fetchedCount += 1; else skippedCount += 1;
        } else if (item.status === 'FAILED' || item.status === 'PENDING') {
          try {
            const detail = await this.client.getPlayerDetail(item.externalId);
            const row = mapPesdataPlayer(detail);
            rows.push(row);
            fetchedCount += 1;
            await this.persistItem(runId, item.externalId, item.summaryChecksum, pesdataValueChecksum(detail), detail, row, 'FETCHED', leaseOwnerToken);
          } catch (error) {
            if (error instanceof PesdataClientError && error.code === 'PESDATA_PROTOCOL_ERROR') throw error;
            if (error instanceof PesdataSyncError && error.code === 'PESDATA_SYNC_LEASE_LOST') throw error;
            failedCount += 1;
          }
        }
      }
      return await this.execute(run.actorId, {
        runId,
        mode: run.mode.toLowerCase() as PesdataSyncMode,
        limit: run.requestedLimit ?? undefined,
        offset: run.currentOffset,
        dryRun: false,
        platformAdmin: true,
        leaseOwnerToken,
        assertLeaseHealthy,
        initial: {
          rows,
          seenExternalIds,
          counters: { sourceTotal: run.sourceTotal, scannedCount: seenExternalIds.size, fetchedCount, skippedCount, failedCount }
        }
      });
      });
    } catch (error) {
      await this.failRun(runId, error, leaseOwnerToken);
      throw error;
    }
  }

  async start(actorId: string, input: StartPesdataSyncInput): Promise<PesdataSyncResult> {
    await this.importService.assertCanCreateBatch(actorId);
    const limit = input.mode === 'sample' ? (input.limit ?? 100) : input.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new PesdataSyncError('PESDATA_LIMIT_INVALID', 'Sync limit must be a positive integer');
    }

    if (input.dryRun) {
      return this.execute(actorId, {
        runId: null,
        mode: input.mode,
        limit,
        offset: 0,
        dryRun: true
      });
    }

    const source = await this.prisma.dataSource.findUnique({ where: { code: 'pesdata' } });
    if (!source?.isEnabled) {
      throw new PesdataSyncError('PESDATA_SOURCE_UNAVAILABLE', 'PESDATA source is missing or disabled');
    }

    let runId: string;
    const leaseOwnerToken = randomUUID();
    try {
      const run = await this.prisma.externalSyncRun.create({
        data: {
          sourceId: source.id,
          actorId,
          mode: databaseMode(input.mode),
          status: 'RUNNING',
          activeLeaseKey: 'pesdata',
          leaseOwnerToken,
          requestedLimit: limit ?? null,
          startedAt: new Date(),
          currentPhase: 'FETCHING',
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + SYNC_LEASE_MS)
        }
      });
      runId = run.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'A PESDATA synchronization is already running');
      }
      throw error;
    }

    try {
      return await this.withLeaseHeartbeat(runId, leaseOwnerToken, (assertLeaseHealthy) => this.execute(actorId, {
        runId,
        mode: input.mode,
        limit,
        offset: 0,
        dryRun: false,
        leaseOwnerToken,
        assertLeaseHealthy
      }));
    } catch (error) {
      await this.failRun(runId, error, leaseOwnerToken);
      throw error;
    }
  }

  async resume(actorId: string, runId: string): Promise<PesdataSyncResult> {
    await this.importService.assertCanCreateBatch(actorId);
    const run = await this.prisma.externalSyncRun.findUnique({
      where: { id: runId },
      include: { items: { orderBy: { createdAt: 'asc' } }, batchLinks: { orderBy: { chunkIndex: 'asc' } } }
    });
    if (!run) throw new PesdataSyncError('PESDATA_RUN_NOT_FOUND', 'Synchronization run was not found');
    if (run.status === 'READY') {
      return {
        runId,
        status: 'READY',
        sourceTotal: run.sourceTotal,
        scannedCount: run.scannedCount,
        fetchedCount: run.fetchedCount,
        skippedCount: run.skippedCount,
        failedCount: run.failedCount,
        batchIds: run.batchLinks.map(({ batchId }) => batchId),
        dryRun: false
      };
    }
    if (run.status !== 'FAILED' || run.activeLeaseKey || run.leaseOwnerToken) {
      throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'This synchronization run is already active');
    }

    const leaseOwnerToken = randomUUID();
    try {
      const resumed = await this.prisma.externalSyncRun.updateMany({
        where: { id: runId, status: 'FAILED', activeLeaseKey: null, leaseOwnerToken: null },
        data: {
          status: 'RUNNING',
          activeLeaseKey: 'pesdata',
          leaseOwnerToken,
          currentPhase: 'FETCHING',
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + SYNC_LEASE_MS),
          errorCode: null,
          errorMessage: null,
          finishedAt: null
        }
      });
      if (resumed.count !== 1) {
        throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'Synchronization run state changed while resuming');
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'A PESDATA synchronization is already running');
      }
      throw error;
    }

    try {
      return await this.withLeaseHeartbeat(runId, leaseOwnerToken, async (assertLeaseHealthy) => {
      const rows: RawImportRow[] = [];
      const seenExternalIds = new Set<string>();
      let fetchedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      for (const item of run.items) {
        seenExternalIds.add(item.externalId);
        if ((item.status === 'FETCHED' || item.status === 'SKIPPED') && item.normalizedJson) {
          rows.push(item.normalizedJson as RawImportRow);
          if (item.status === 'FETCHED') fetchedCount += 1;
          else skippedCount += 1;
        } else if (item.status === 'FAILED' || item.status === 'PENDING') {
          try {
            const detail = await this.client.getPlayerDetail(item.externalId);
            const row = mapPesdataPlayer(detail);
            rows.push(row);
            fetchedCount += 1;
            await this.persistItem(
              runId,
              item.externalId,
              item.summaryChecksum,
              pesdataValueChecksum(detail),
              detail,
              row,
              'FETCHED',
              leaseOwnerToken
            );
          } catch (error) {
            if (error instanceof PesdataClientError && error.code === 'PESDATA_PROTOCOL_ERROR') throw error;
            if (error instanceof PesdataSyncError && error.code === 'PESDATA_SYNC_LEASE_LOST') throw error;
            failedCount += 1;
          }
        }
      }

      return await this.execute(actorId, {
        runId,
        mode: run.mode.toLowerCase() as PesdataSyncMode,
        limit: run.requestedLimit ?? undefined,
        offset: run.currentOffset,
        dryRun: false,
        leaseOwnerToken,
        assertLeaseHealthy,
        initial: {
          rows,
          seenExternalIds,
          counters: {
            sourceTotal: run.sourceTotal,
            scannedCount: seenExternalIds.size,
            fetchedCount,
            skippedCount,
            failedCount
          }
        }
      });
      });
    } catch (error) {
      await this.failRun(runId, error, leaseOwnerToken);
      throw error;
    }
  }

  async createImportBatches(
    actorId: string,
    runId: string,
    rows: RawImportRow[],
    persistLinks = true,
    platformAdmin = false,
    leaseOwnerToken?: string,
    assertLeaseHealthy?: () => void
  ): Promise<string[]> {
    const sorted = [...rows].sort((left, right) =>
      comparePesdataExternalIds(String(left.externalId ?? ''), String(right.externalId ?? ''))
    );
    const batchIds: string[] = [];

    for (let start = 0, chunkIndex = 1; start < sorted.length; start += IMPORT_CHUNK_SIZE, chunkIndex += 1) {
      if (leaseOwnerToken) await this.touchLease(runId, leaseOwnerToken);
      assertLeaseHealthy?.();
      const content = JSON.stringify(sorted.slice(start, start + IMPORT_CHUNK_SIZE));
      const input = {
        sourceCode: 'pesdata',
        fileName: `pesdata-${runId}-${String(chunkIndex).padStart(3, '0')}.json`,
        format: 'JSON',
        content
      } as const;
      const outcome = platformAdmin
        ? await this.importService.createBatchForPlatformAdmin(actorId, input)
        : await this.importService.createBatchWithOutcome(actorId, input);
      try {
        assertLeaseHealthy?.();
        if (persistLinks) {
          await this.prisma.$transaction(async (tx) => {
            if (leaseOwnerToken) await this.touchLease(runId, leaseOwnerToken, tx);
            await tx.externalSyncRunBatch.upsert({
              where: { runId_batchId: { runId, batchId: outcome.batch.id } },
              update: { chunkIndex },
              create: { runId, batchId: outcome.batch.id, chunkIndex }
            });
          });
        }
      } catch (error) {
        if (outcome.created) await this.cleanupUnlinkedImportBatch(outcome.batch.id);
        throw error;
      }
      batchIds.push(outcome.batch.id);
    }
    return batchIds;
  }

  private async execute(
    actorId: string,
    state: {
      runId: string | null;
      mode: PesdataSyncMode;
      limit?: number | undefined;
      offset: number;
      dryRun: boolean;
      platformAdmin?: boolean;
      leaseOwnerToken?: string;
      assertLeaseHealthy?: () => void;
      initial?: {
        rows: RawImportRow[];
        seenExternalIds: Set<string>;
        counters: SyncCounters;
      };
    }
  ): Promise<PesdataSyncResult> {
    const counters: SyncCounters = state.initial?.counters ?? {
      sourceTotal: null,
      scannedCount: 0,
      fetchedCount: 0,
      skippedCount: 0,
      failedCount: 0
    };
    const rows: RawImportRow[] = state.initial?.rows ?? [];
    const seenExternalIds = state.initial?.seenExternalIds ?? new Set<string>();
    let offset = state.offset;

    while (state.limit === undefined || counters.scannedCount < state.limit) {
      const remaining = state.limit === undefined
        ? this.pageSize
        : Math.min(this.pageSize, state.limit - counters.scannedCount);
      const page = await this.client.listPlayers({ start: offset, limit: remaining, order: 'DESC' });
      state.assertLeaseHealthy?.();
      if (state.runId && state.leaseOwnerToken) await this.touchLease(state.runId, state.leaseOwnerToken);
      counters.sourceTotal = page.count;
      if (page.list.length === 0) break;

      const selected = page.list.slice(0, remaining);
      for (const summary of selected) {
        const externalId = externalIdOf(summary);
        const summaryChecksum = pesdataValueChecksum(summary);
        if (seenExternalIds.has(externalId)) continue;
        seenExternalIds.add(externalId);
        counters.scannedCount += 1;
        try {
          if (state.mode === 'incremental' && state.runId) {
            const prior = await this.latestSuccessfulItem(state.runId, externalId);
            if (prior?.summaryChecksum === summaryChecksum && prior.normalizedJson) {
              const row = prior.normalizedJson as RawImportRow;
              rows.push(row);
              counters.skippedCount += 1;
              await this.persistSkippedItem(state.runId, externalId, summaryChecksum, prior, row, state.leaseOwnerToken);
              continue;
            }
          }
          const detail = await this.client.getPlayerDetail(externalId);
          const row = mapPesdataPlayer(detail);
          const detailChecksum = pesdataValueChecksum(detail);
          rows.push(row);
          counters.fetchedCount += 1;
          if (state.runId) {
            await this.persistItem(state.runId, externalId, summaryChecksum, detailChecksum, detail, row, 'FETCHED', state.leaseOwnerToken);
          }
        } catch (error) {
          if (error instanceof PesdataClientError && error.code === 'PESDATA_PROTOCOL_ERROR') throw error;
          if (error instanceof PesdataSyncError && error.code === 'PESDATA_SYNC_LEASE_LOST') throw error;
          counters.failedCount += 1;
          if (state.runId) {
            await this.persistFailedItem(state.runId, externalId, summaryChecksum, error, state.leaseOwnerToken);
          }
        }
      }

      offset += page.list.length;
      if (state.runId) {
        const heartbeatAt = new Date();
        const checkpoint = await this.prisma.externalSyncRun.updateMany({
          where: { id: state.runId, status: 'RUNNING', ...(state.leaseOwnerToken ? { leaseOwnerToken: state.leaseOwnerToken } : {}) },
          data: {
            sourceTotal: counters.sourceTotal,
            scannedCount: counters.scannedCount,
            fetchedCount: counters.fetchedCount,
            skippedCount: counters.skippedCount,
            failedCount: counters.failedCount,
            currentOffset: offset,
            currentPhase: 'FETCHING',
            heartbeatAt,
            leaseExpiresAt: new Date(heartbeatAt.getTime() + SYNC_LEASE_MS)
          }
        });
        if (checkpoint.count !== 1) this.throwLeaseLost();
      }
      if (page.list.length < remaining) break;
    }

    const batchIds = state.dryRun || !state.runId
      ? []
      : await this.createImportBatches(
        actorId,
        state.runId,
        rows,
        true,
        state.platformAdmin ?? false,
        state.leaseOwnerToken,
        state.assertLeaseHealthy
      );

    if (state.runId) {
      const completed = await this.prisma.externalSyncRun.updateMany({
        where: { id: state.runId, status: 'RUNNING', ...(state.leaseOwnerToken ? { leaseOwnerToken: state.leaseOwnerToken } : {}) },
        data: {
          status: 'READY',
          activeLeaseKey: null,
          leaseOwnerToken: null,
          leaseExpiresAt: null,
          heartbeatAt: new Date(),
          currentPhase: 'READY',
          finishedAt: new Date(),
          sourceTotal: counters.sourceTotal,
          scannedCount: counters.scannedCount,
          fetchedCount: counters.fetchedCount,
          skippedCount: counters.skippedCount,
          failedCount: counters.failedCount,
          currentOffset: offset
        }
      });
      if (completed.count !== 1) this.throwLeaseLost();
    }

    return {
      runId: state.runId,
      status: 'READY',
      ...counters,
      batchIds,
      dryRun: state.dryRun
    };
  }

  private async persistItem(
    runId: string,
    externalId: string,
    summaryChecksum: string,
    detailChecksum: string,
    detail: PesdataPlayerDetail,
    row: RawImportRow,
    status: 'FETCHED' | 'SKIPPED',
    leaseOwnerToken?: string
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (leaseOwnerToken) await this.touchLease(runId, leaseOwnerToken, tx);
      await tx.externalSyncItem.upsert({
        where: { runId_externalId: { runId, externalId } },
        update: {
          summaryChecksum,
          detailChecksum,
          status,
          rawDetail: jsonValue(detail),
          normalizedJson: jsonValue(row),
          attempts: { increment: 1 },
          lastError: null
        },
        create: {
          runId,
          externalId,
          summaryChecksum,
          detailChecksum,
          status,
          rawDetail: jsonValue(detail),
          normalizedJson: jsonValue(row),
          attempts: 1
        }
      });
    });
  }

  private async persistSkippedItem(
    runId: string,
    externalId: string,
    summaryChecksum: string,
    prior: { detailChecksum: string | null; rawDetail: unknown },
    row: RawImportRow,
    leaseOwnerToken?: string
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (leaseOwnerToken) await this.touchLease(runId, leaseOwnerToken, tx);
      await tx.externalSyncItem.create({
        data: {
          runId,
          externalId,
          summaryChecksum,
          detailChecksum: prior.detailChecksum,
          status: 'SKIPPED',
          rawDetail: prior.rawDetail === null ? Prisma.JsonNull : jsonValue(prior.rawDetail),
          normalizedJson: jsonValue(row),
          attempts: 0
        }
      });
    });
  }

  private async persistFailedItem(
    runId: string,
    externalId: string,
    summaryChecksum: string,
    error: unknown,
    leaseOwnerToken?: string
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (leaseOwnerToken) await this.touchLease(runId, leaseOwnerToken, tx);
      await tx.externalSyncItem.upsert({
        where: { runId_externalId: { runId, externalId } },
        update: {
          summaryChecksum,
          status: 'FAILED',
          attempts: { increment: 1 },
          lastError: this.errorCode(error)
        },
        create: {
          runId,
          externalId,
          summaryChecksum,
          status: 'FAILED',
          attempts: 1,
          lastError: this.errorCode(error)
        }
      });
    });
  }

  private async touchLease(
    runId: string,
    leaseOwnerToken: string,
    client: Pick<Prisma.TransactionClient, 'externalSyncRun'> = this.prisma
  ): Promise<void> {
    const heartbeatAt = new Date();
    const renewed = await client.externalSyncRun.updateMany({
      where: { id: runId, status: 'RUNNING', activeLeaseKey: 'pesdata', leaseOwnerToken },
      data: { heartbeatAt, leaseExpiresAt: new Date(heartbeatAt.getTime() + SYNC_LEASE_MS) }
    });
    if (renewed.count !== 1) this.throwLeaseLost();
  }

  private async withLeaseHeartbeat<T>(
    runId: string,
    leaseOwnerToken: string,
    work: (assertLeaseHealthy: () => void) => Promise<T>
  ): Promise<T> {
    let heartbeat: Promise<void> | null = null;
    let heartbeatError: unknown;
    const assertLeaseHealthy = () => {
      if (heartbeatError) throw heartbeatError;
    };
    const timer = setInterval(() => {
      if (heartbeat || heartbeatError) return;
      heartbeat = this.touchLease(runId, leaseOwnerToken)
        .catch((error: unknown) => { heartbeatError = error; })
        .finally(() => { heartbeat = null; });
    }, this.heartbeatIntervalMs);
    timer.unref?.();
    try {
      return await work(assertLeaseHealthy);
    } finally {
      clearInterval(timer);
      await heartbeat;
    }
  }

  private async cleanupUnlinkedImportBatch(batchId: string): Promise<void> {
    await this.prisma.importBatch.deleteMany({ where: {
      id: batchId,
      status: { in: ['UPLOADED', 'VALIDATED', 'READY', 'FAILED', 'CANCELLED'] },
      syncRunLinks: { none: {} },
      release: { is: null }
    } });
  }

  private throwLeaseLost(): never {
    throw new PesdataSyncError('PESDATA_SYNC_LEASE_LOST', 'Synchronization lease ownership was lost');
  }

  private latestSuccessfulItem(runId: string, externalId: string) {
    return this.prisma.externalSyncItem.findFirst({
      where: {
        runId: { not: runId },
        externalId,
        status: { in: ['FETCHED', 'SKIPPED'] },
        run: { status: 'READY', source: { code: 'pesdata' } }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }

  private async failRun(runId: string, error: unknown, leaseOwnerToken?: string): Promise<void> {
    await this.prisma.externalSyncRun.updateMany({
      where: { id: runId, ...(leaseOwnerToken ? { leaseOwnerToken } : {}) },
      data: {
        status: 'FAILED',
        activeLeaseKey: null,
        leaseOwnerToken: null,
        leaseExpiresAt: null,
        heartbeatAt: new Date(),
        currentPhase: 'FAILED',
        finishedAt: new Date(),
        errorCode: this.errorCode(error),
        errorMessage: error instanceof Error ? error.message.slice(0, 512) : 'PESDATA synchronization failed'
      }
    });
  }

  private errorCode(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
      return error.code;
    }
    return error instanceof PesdataMappingError ? error.code : 'PESDATA_ITEM_FAILED';
  }
}
