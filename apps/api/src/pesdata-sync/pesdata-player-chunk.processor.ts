import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import { PesdataClient, PesdataClientError } from './pesdata-client.js';
import { mapPesdataPlayer, pesdataValueChecksum, PesdataMappingError } from './pesdata-mapper.js';
import type { PesdataPlayerSummary } from './pesdata.schemas.js';
import { PesdataSyncError, type SyncChunkOutcome } from './pesdata-sync.types.js';
import { SYNC_LEASE_MS } from '../platform-data-sync/platform-data-sync.constants.js';

function externalIdOf(summary: PesdataPlayerSummary): string {
  const value = String(summary.playerId).trim();
  if (!value) throw new PesdataMappingError('playerId');
  return value;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class PesdataPlayerChunkProcessor {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerImportService) private readonly imports: PlayerImportService,
    @Inject(PesdataClient) private readonly client: PesdataClient
  ) {}

  async processNextChunk(runId: string): Promise<SyncChunkOutcome> {
    const leaseOwnerToken = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.externalSyncRun.updateMany({
      where: { id: runId, status: 'PENDING', activeLeaseKey: 'pesdata', leaseOwnerToken: null },
      data: {
        status: 'RUNNING',
        leaseOwnerToken,
        currentPhase: 'FETCHING',
        startedAt: now,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS)
      }
    });
    if (claimed.count !== 1) {
      const run = await this.prisma.externalSyncRun.findUnique({ where: { id: runId } });
      if (!run) throw new PesdataSyncError('PESDATA_RUN_NOT_FOUND', 'Synchronization run was not found');
      if (run.status === 'READY') return {
        disposition: 'STOP', status: 'READY', completionReason: run.completionReason
      };
      throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'Synchronization chunk is not available to claim');
    }

    const run = await this.prisma.externalSyncRun.findUniqueOrThrow({ where: { id: runId } });
    try {
      const page = await this.client.listPlayers({
        start: run.currentOffset,
        limit: run.chunkSize,
        order: 'DESC'
      });
      const unique = new Map<string, PesdataPlayerSummary>();
      for (const summary of page.list) {
        const externalId = externalIdOf(summary);
        if (!unique.has(externalId)) unique.set(externalId, summary);
      }
      const externalIds = [...unique.keys()];
      const [seenInRun, catalogCards, pendingRecords] = externalIds.length === 0
        ? [[], [], []] as const
        : await Promise.all([
          this.prisma.externalSyncItem.findMany({
            where: { runId, externalId: { in: externalIds } }, select: { externalId: true }
          }),
          this.prisma.playerCard.findMany({
            where: { sourceId: run.sourceId, externalId: { in: externalIds } }, select: { externalId: true }
          }),
          this.prisma.importRecord.findMany({
            where: {
              externalId: { in: externalIds },
              batch: { sourceId: run.sourceId, status: { in: ['UPLOADED', 'VALIDATED', 'READY', 'PUBLISHED'] } }
            },
            select: { externalId: true }
          })
        ]);
      const alreadySeen = new Set(seenInRun.map(({ externalId }) => externalId));
      const unavailable = new Set([
        ...catalogCards.map(({ externalId }) => externalId),
        ...pendingRecords.flatMap(({ externalId }) => externalId ? [externalId] : [])
      ]);
      const remainingTarget = run.mode === 'SAMPLE' && run.requestedLimit !== null
        ? Math.max(0, run.requestedLimit - run.matchedCount)
        : Number.POSITIVE_INFINITY;
      const candidates = [...unique.entries()]
        .filter(([externalId]) => !alreadySeen.has(externalId))
        .filter(([externalId]) => run.mode !== 'SAMPLE' || !unavailable.has(externalId))
        .slice(0, remainingTarget);
      const candidateIds = new Set(candidates.map(([externalId]) => externalId));
      const fetched: Array<{
        externalId: string;
        summaryChecksum: string;
        detailChecksum: string;
        rawDetail: Prisma.InputJsonValue;
        normalized: ReturnType<typeof mapPesdataPlayer>;
      }> = [];
      const failures: Array<{ externalId: string; summaryChecksum: string; message: string }> = [];
      for (const [externalId, summary] of candidates) {
        try {
          const detail = await this.client.getPlayerDetail(externalId);
          fetched.push({
            externalId,
            summaryChecksum: pesdataValueChecksum(summary),
            detailChecksum: pesdataValueChecksum(detail),
            rawDetail: jsonValue(detail),
            normalized: mapPesdataPlayer(detail)
          });
        } catch (error) {
          if (error instanceof PesdataClientError && error.code === 'PESDATA_PROTOCOL_ERROR') throw error;
          failures.push({
            externalId,
            summaryChecksum: pesdataValueChecksum(summary),
            message: error instanceof Error ? error.message.slice(0, 512) : 'Unknown PESDATA detail error'
          });
        }
      }
      const scannedIds = [...unique.keys()].filter((externalId) => !alreadySeen.has(externalId));
      const skippedIds = scannedIds.filter((externalId) => !candidateIds.has(externalId));
      const nextOffset = run.currentOffset + page.list.length;
      const sourceExhausted = page.list.length === 0 || nextOffset >= page.count;

      return await this.prisma.$transaction(async (tx) => {
        const owned = await tx.externalSyncRun.findFirst({
          where: { id: runId, status: 'RUNNING', leaseOwnerToken },
          select: { pauseRequestedAt: true, matchedCount: true, requestedLimit: true, chunkIndex: true }
        });
        if (!owned) throw new PesdataSyncError('PESDATA_SYNC_LEASE_LOST', 'Synchronization lease ownership was lost');
        let batchId: string | null = null;
        if (fetched.length > 0) {
          const chunkIndex = owned.chunkIndex + 1;
          const outcome = await this.imports.createBatchForPlatformAdminInTransaction(tx, run.actorId, {
            sourceCode: 'pesdata',
            fileName: `pesdata-${runId}-${String(chunkIndex).padStart(3, '0')}.json`,
            format: 'JSON',
            content: JSON.stringify(fetched.map(({ normalized }) => normalized))
          });
          batchId = outcome.batch.id;
          await tx.externalSyncRunBatch.upsert({
            where: { runId_batchId: { runId, batchId } },
            update: { chunkIndex },
            create: { runId, batchId, chunkIndex }
          });
        }
        await tx.externalSyncItem.createMany({
          data: [
            ...fetched.map((item) => ({
              runId, externalId: item.externalId, summaryChecksum: item.summaryChecksum,
              detailChecksum: item.detailChecksum, status: 'FETCHED' as const,
              rawDetail: item.rawDetail, normalizedJson: jsonValue(item.normalized)
            })),
            ...skippedIds.map((externalId) => ({
              runId, externalId, summaryChecksum: pesdataValueChecksum(unique.get(externalId)!),
              status: 'SKIPPED' as const
            })),
            ...failures.map((failure) => ({
              runId, externalId: failure.externalId, summaryChecksum: failure.summaryChecksum,
              status: 'FAILED' as const, lastError: failure.message
            }))
          ],
          skipDuplicates: true
        });
        const matchedCount = owned.matchedCount + fetched.length;
        const targetReached = owned.requestedLimit !== null && matchedCount >= owned.requestedLimit;
        const completionReason = targetReached ? 'TARGET_REACHED' as const
          : sourceExhausted ? 'SOURCE_EXHAUSTED' as const : null;
        const status = completionReason ? 'READY' as const
          : owned.pauseRequestedAt ? 'PAUSED' as const : 'PENDING' as const;
        const heartbeatAt = new Date();
        await tx.externalSyncRun.update({
          where: { id: runId },
          data: {
            status,
            activeLeaseKey: completionReason ? null : 'pesdata',
            leaseOwnerToken: null,
            leaseExpiresAt: null,
            pauseRequestedAt: status === 'PAUSED' ? null : owned.pauseRequestedAt,
            currentPhase: status === 'READY' ? 'READY' : status === 'PAUSED' ? 'PAUSED' : 'QUEUED',
            heartbeatAt,
            finishedAt: status === 'READY' ? heartbeatAt : null,
            sourceTotal: page.count,
            matchedCount,
            scannedCount: { increment: scannedIds.length },
            fetchedCount: { increment: fetched.length },
            skippedCount: { increment: skippedIds.length },
            failedCount: { increment: failures.length },
            currentOffset: nextOffset,
            chunkIndex: { increment: batchId ? 1 : 0 },
            completionReason
          }
        });
        return {
          disposition: status === 'PENDING' ? 'CONTINUE' : 'STOP',
          status,
          completionReason
        } satisfies SyncChunkOutcome;
      }, { timeout: 15_000 });
    } catch (error) {
      await this.prisma.externalSyncRun.updateMany({
        where: { id: runId, status: 'RUNNING', leaseOwnerToken },
        data: {
          status: 'FAILED', activeLeaseKey: null, leaseOwnerToken: null, leaseExpiresAt: null,
          currentPhase: 'FAILED', errorCode: error instanceof PesdataSyncError ? error.code : 'PESDATA_SYNC_FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 512) : 'Unknown sync failure', finishedAt: new Date()
        }
      });
      throw error;
    }
  }
}
