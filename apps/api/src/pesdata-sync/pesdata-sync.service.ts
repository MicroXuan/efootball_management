import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { ExternalSyncMode } from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import type { RawImportRow } from '../player-import/import-adapter.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import { PesdataClient, PesdataClientError } from './pesdata-client.js';
import { mapPesdataPlayer, pesdataValueChecksum, PesdataMappingError } from './pesdata-mapper.js';
import type { PesdataPlayerDetail, PesdataPlayerSummary } from './pesdata.schemas.js';
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

type ServiceOptions = { pageSize?: number };
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

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerImportService) private readonly importService: PlayerImportService,
    @Inject(PesdataClient) private readonly client: PesdataClient,
    @Optional() @Inject(PESDATA_SYNC_OPTIONS) options: ServiceOptions = {}
  ) {
    this.pageSize = options.pageSize ?? 100;
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
    try {
      const run = await this.prisma.externalSyncRun.create({
        data: {
          sourceId: source.id,
          actorId,
          mode: databaseMode(input.mode),
          status: 'RUNNING',
          activeLeaseKey: 'pesdata',
          requestedLimit: limit ?? null,
          startedAt: new Date()
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
      return await this.execute(actorId, {
        runId,
        mode: input.mode,
        limit,
        offset: 0,
        dryRun: false
      });
    } catch (error) {
      await this.failRun(runId, error);
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
    if (run.activeLeaseKey) {
      throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'This synchronization run is already active');
    }

    try {
      await this.prisma.externalSyncRun.update({
        where: { id: runId },
        data: {
          status: 'RUNNING',
          activeLeaseKey: 'pesdata',
          errorCode: null,
          errorMessage: null,
          finishedAt: null
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'A PESDATA synchronization is already running');
      }
      throw error;
    }

    try {
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
              'FETCHED'
            );
          } catch (error) {
            if (error instanceof PesdataClientError && error.code === 'PESDATA_PROTOCOL_ERROR') throw error;
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
    } catch (error) {
      await this.failRun(runId, error);
      throw error;
    }
  }

  async createImportBatches(
    actorId: string,
    runId: string,
    rows: RawImportRow[],
    persistLinks = true
  ): Promise<string[]> {
    const sorted = [...rows].sort((left, right) =>
      comparePesdataExternalIds(String(left.externalId ?? ''), String(right.externalId ?? ''))
    );
    const batchIds: string[] = [];

    for (let start = 0, chunkIndex = 1; start < sorted.length; start += IMPORT_CHUNK_SIZE, chunkIndex += 1) {
      const content = JSON.stringify(sorted.slice(start, start + IMPORT_CHUNK_SIZE));
      const outcome = await this.importService.createBatchWithOutcome(actorId, {
        sourceCode: 'pesdata',
        fileName: `pesdata-${runId}-${String(chunkIndex).padStart(3, '0')}.json`,
        format: 'JSON',
        content
      });
      batchIds.push(outcome.batch.id);
      if (persistLinks) {
        await this.prisma.externalSyncRunBatch.upsert({
          where: { runId_batchId: { runId, batchId: outcome.batch.id } },
          update: { chunkIndex },
          create: { runId, batchId: outcome.batch.id, chunkIndex }
        });
      }
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
              await this.prisma.externalSyncItem.create({
                data: {
                  runId: state.runId,
                  externalId,
                  summaryChecksum,
                  detailChecksum: prior.detailChecksum,
                  status: 'SKIPPED',
                  rawDetail: prior.rawDetail === null ? Prisma.JsonNull : jsonValue(prior.rawDetail),
                  normalizedJson: jsonValue(row),
                  attempts: 0
                }
              });
              continue;
            }
          }
          const detail = await this.client.getPlayerDetail(externalId);
          const row = mapPesdataPlayer(detail);
          const detailChecksum = pesdataValueChecksum(detail);
          rows.push(row);
          counters.fetchedCount += 1;
          if (state.runId) {
            await this.persistItem(state.runId, externalId, summaryChecksum, detailChecksum, detail, row, 'FETCHED');
          }
        } catch (error) {
          if (error instanceof PesdataClientError && error.code === 'PESDATA_PROTOCOL_ERROR') throw error;
          counters.failedCount += 1;
          if (state.runId) {
            await this.prisma.externalSyncItem.upsert({
              where: { runId_externalId: { runId: state.runId, externalId } },
              update: {
                summaryChecksum,
                status: 'FAILED',
                attempts: { increment: 1 },
                lastError: this.errorCode(error)
              },
              create: {
                runId: state.runId,
                externalId,
                summaryChecksum,
                status: 'FAILED',
                attempts: 1,
                lastError: this.errorCode(error)
              }
            });
          }
        }
      }

      offset += page.list.length;
      if (state.runId) {
        await this.prisma.externalSyncRun.update({
          where: { id: state.runId },
          data: {
            sourceTotal: counters.sourceTotal,
            scannedCount: counters.scannedCount,
            fetchedCount: counters.fetchedCount,
            skippedCount: counters.skippedCount,
            failedCount: counters.failedCount,
            currentOffset: offset
          }
        });
      }
      if (page.list.length < remaining) break;
    }

    const batchIds = state.dryRun || !state.runId
      ? []
      : await this.createImportBatches(actorId, state.runId, rows);

    if (state.runId) {
      await this.prisma.externalSyncRun.update({
        where: { id: state.runId },
        data: {
          status: 'READY',
          activeLeaseKey: null,
          finishedAt: new Date(),
          sourceTotal: counters.sourceTotal,
          scannedCount: counters.scannedCount,
          fetchedCount: counters.fetchedCount,
          skippedCount: counters.skippedCount,
          failedCount: counters.failedCount,
          currentOffset: offset
        }
      });
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
    status: 'FETCHED' | 'SKIPPED'
  ): Promise<void> {
    await this.prisma.externalSyncItem.upsert({
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

  private async failRun(runId: string, error: unknown): Promise<void> {
    await this.prisma.externalSyncRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        activeLeaseKey: null,
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
