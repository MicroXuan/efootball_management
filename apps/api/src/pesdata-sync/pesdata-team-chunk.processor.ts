import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PesdataClient, PesdataClientError } from './pesdata-client.js';
import { PesdataCrestLoader } from './pesdata-crest-loader.js';
import { pesdataValueChecksum } from './pesdata-mapper.js';
import { mapPesdataTeam } from './pesdata-team-mapper.js';
import type { SyncChunkOutcome } from './pesdata-sync.types.js';
import { SYNC_HEARTBEAT_INTERVAL_MS, SYNC_LEASE_MS } from '../platform-data-sync/platform-data-sync.constants.js';

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

class PesdataTeamChunkError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

@Injectable()
export class PesdataTeamChunkProcessor {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PesdataClient) private readonly client: PesdataClient,
    @Inject(PesdataCrestLoader) private readonly crestLoader: PesdataCrestLoader
  ) {}

  async processNextChunk(runId: string): Promise<SyncChunkOutcome> {
    const leaseOwnerToken = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.teamCatalogSyncRun.updateMany({
      where: { id: runId, status: 'PENDING', activeLeaseKey: 'pesdata-team-catalog', leaseOwnerToken: null },
      data: {
        status: 'RUNNING', leaseOwnerToken, currentPhase: 'FETCHING', startedAt: now,
        heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS)
      }
    });
    if (claimed.count !== 1) {
      const run = await this.prisma.teamCatalogSyncRun.findUnique({ where: { id: runId } });
      if (!run) throw new PesdataTeamChunkError('PESDATA_TEAM_RUN_NOT_FOUND', 'Team synchronization run was not found');
      if (run.status === 'READY') return { disposition: 'STOP', status: 'READY', completionReason: run.completionReason };
      throw new PesdataTeamChunkError('PESDATA_TEAM_SYNC_CONFLICT', 'Team synchronization chunk is not available to claim');
    }
    const run = await this.prisma.teamCatalogSyncRun.findUniqueOrThrow({ where: { id: runId } });
    let heartbeatFailure: PesdataTeamChunkError | null = null;
    const heartbeat = setInterval(() => {
      const heartbeatAt = new Date();
      void this.prisma.teamCatalogSyncRun.updateMany({
        where: { id: runId, status: 'RUNNING', leaseOwnerToken, leaseExpiresAt: { gt: heartbeatAt } },
        data: { heartbeatAt, leaseExpiresAt: new Date(heartbeatAt.getTime() + SYNC_LEASE_MS) }
      }).then(({ count }) => {
        if (count !== 1) heartbeatFailure = new PesdataTeamChunkError('PESDATA_TEAM_SYNC_LEASE_LOST', 'Team synchronization lease ownership was lost');
      }).catch(() => {
        heartbeatFailure = new PesdataTeamChunkError('PESDATA_TEAM_SYNC_HEARTBEAT_FAILED', 'Team synchronization lease could not be renewed');
      });
    }, SYNC_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();
    try {
      const page = await this.client.listTeams({ start: run.currentOffset, limit: run.chunkSize, order: 'ASC' });
      const unique = new Map(page.list.map((item) => [item.teamId, item]));
      const externalIds = [...unique.keys()];
      const [seenItems, currentItems, pendingItems] = externalIds.length === 0 ? [[], [], []] as const : await Promise.all([
        this.prisma.teamCatalogSyncItem.findMany({
          where: { runId, sourceExternalId: { in: externalIds } }, select: { sourceExternalId: true }
        }),
        this.prisma.teamCatalogItem.findMany({
          where: { sourceType: 'PESDATA', sourceExternalId: { in: externalIds } }
        }),
        this.prisma.teamCatalogSyncItem.findMany({
          where: { runId: { not: runId }, sourceExternalId: { in: externalIds }, reviewStatus: 'PENDING' },
          select: { sourceExternalId: true }
        })
      ]);
      const seen = new Set(seenItems.map(({ sourceExternalId }) => sourceExternalId));
      const currentByExternalId = new Map(currentItems.flatMap((item) => item.sourceExternalId ? [[item.sourceExternalId, item] as const] : []));
      const pendingExternalIds = new Set(pendingItems.map(({ sourceExternalId }) => sourceExternalId));
      const remainingTarget = run.mode === 'SAMPLE' && run.requestedLimit !== null
        ? Math.max(0, run.requestedLimit - run.matchedCount)
        : Number.POSITIVE_INFINITY;
      const candidates = [...unique.entries()]
        .filter(([externalId]) => !seen.has(externalId))
        .filter(([externalId]) => !pendingExternalIds.has(externalId))
        .filter(([externalId]) => run.mode !== 'SAMPLE' || !currentByExternalId.has(externalId))
        .slice(0, remainingTarget);
      const staged: Array<{
        sourceExternalId: string;
        summaryChecksum: string;
        detailChecksum: string;
        changeType: 'ADDED' | 'UPDATED';
        currentCatalogItemId: string | null;
        candidateJson: Prisma.InputJsonValue;
        rawDetail: Prisma.InputJsonValue;
      }> = [];
      const failures: Array<{ sourceExternalId: string; summaryChecksum: string; message: string; code: string }> = [];
      for (const [externalId, summary] of candidates) {
        try {
          const detail = await this.client.getTeamDetail(externalId);
          let candidate = mapPesdataTeam({
            ...detail,
            leagueId: detail.leagueId ?? summary.leagueId,
            leagueName: detail.leagueName ?? summary.leagueName
          });
          if (candidate.remoteLogoUrl) candidate = { ...candidate, ...(await this.crestLoader.load(candidate)) };
          const current = currentByExternalId.get(externalId);
          const detailChecksum = pesdataValueChecksum(candidate);
          if (run.mode === 'INCREMENTAL' && current?.sourceChecksum === detailChecksum) continue;
          staged.push({
            sourceExternalId: externalId,
            summaryChecksum: pesdataValueChecksum(summary),
            detailChecksum,
            changeType: current ? 'UPDATED' : 'ADDED',
            currentCatalogItemId: current?.id ?? null,
            candidateJson: json(candidate),
            rawDetail: json(detail)
          });
        } catch (error) {
          if (error instanceof PesdataClientError && error.code === 'PESDATA_PROTOCOL_ERROR') throw error;
          failures.push({
            sourceExternalId: externalId,
            summaryChecksum: pesdataValueChecksum(summary),
            code: error && typeof error === 'object' && 'code' in error ? String(error.code).slice(0, 128) : 'PESDATA_TEAM_ITEM_FAILED',
            message: (error instanceof Error ? error.message : String(error)).slice(0, 512)
          });
        }
      }
      const scannedIds = externalIds.filter((externalId) => !seen.has(externalId));
      const stagedIds = new Set(candidates.map(([externalId]) => externalId));
      const skippedKnown = scannedIds.filter((externalId) =>
        !stagedIds.has(externalId) && (currentByExternalId.has(externalId) || pendingExternalIds.has(externalId))
      );
      const nextOffset = run.currentOffset + page.list.length;
      const sourceExhausted = page.list.length === 0;
      if (heartbeatFailure) throw heartbeatFailure;
      return await this.prisma.$transaction(async (tx) => {
        const commitStartedAt = new Date();
        const owned = await tx.teamCatalogSyncRun.findFirst({
          where: { id: runId, status: 'RUNNING', leaseOwnerToken, leaseExpiresAt: { gt: commitStartedAt } },
          select: { pauseRequestedAt: true, matchedCount: true, requestedLimit: true, chunkIndex: true }
        });
        if (!owned) throw new PesdataTeamChunkError('PESDATA_TEAM_SYNC_LEASE_LOST', 'Team synchronization lease ownership was lost');
        if (staged.length > 0 || failures.length > 0 || skippedKnown.length > 0) {
          await tx.teamCatalogSyncItem.createMany({
            data: [
              ...staged.map((item) => ({ ...item, runId, reviewStatus: 'PENDING' as const, attempts: 1 })),
              ...skippedKnown.map((sourceExternalId) => ({
                runId,
                sourceExternalId,
                summaryChecksum: pesdataValueChecksum(unique.get(sourceExternalId)!),
                changeType: 'UPDATED' as const,
                reviewStatus: 'REJECTED' as const,
                currentCatalogItemId: currentByExternalId.get(sourceExternalId)?.id ?? null,
                attempts: 1
              })),
              ...failures.map((item) => ({
                runId, sourceExternalId: item.sourceExternalId, summaryChecksum: item.summaryChecksum,
                changeType: 'UPDATED' as const, reviewStatus: 'FAILED' as const, attempts: 1,
                errorCode: item.code, errorMessage: item.message
              }))
            ],
            skipDuplicates: true
          });
        }
        let missingCount = 0;
        if (run.mode === 'FULL' && sourceExhausted) {
          const sourceRows = await tx.teamCatalogSyncItem.findMany({
            where: { runId, changeType: { not: 'SOURCE_MISSING' } }, select: { sourceExternalId: true }
          });
          const sourceIds = sourceRows.map(({ sourceExternalId }) => sourceExternalId);
          const missing = await tx.teamCatalogItem.findMany({
            where: { sourceType: 'PESDATA', sourceExternalId: { not: null, notIn: sourceIds } }
          });
          if (missing.length > 0) await tx.teamCatalogSyncItem.createMany({
            data: missing.flatMap((item) => item.sourceExternalId ? [{
              runId,
              sourceExternalId: item.sourceExternalId,
              summaryChecksum: item.sourceChecksum ?? pesdataValueChecksum(item.sourceExternalId),
              changeType: 'SOURCE_MISSING' as const,
              currentCatalogItemId: item.id
            }] : []),
            skipDuplicates: true
          });
          missingCount = await tx.teamCatalogSyncItem.count({ where: { runId, changeType: 'SOURCE_MISSING' } });
        }
        const added = staged.filter(({ changeType }) => changeType === 'ADDED').length;
        const updated = staged.length - added;
        const matchedCount = owned.matchedCount + added;
        const targetReached = owned.requestedLimit !== null && matchedCount >= owned.requestedLimit;
        const completionReason = targetReached ? 'TARGET_REACHED' as const
          : sourceExhausted ? 'SOURCE_EXHAUSTED' as const : null;
        const status = completionReason ? 'READY' as const
          : owned.pauseRequestedAt ? 'PAUSED' as const : 'PENDING' as const;
        const heartbeatAt = new Date();
        const finalCommitAt = new Date();
        const committed = await tx.teamCatalogSyncRun.updateMany({
          where: {
            id: runId, status: 'RUNNING', leaseOwnerToken, leaseExpiresAt: { gt: finalCommitAt }
          },
          data: {
            status,
            activeLeaseKey: completionReason ? null : 'pesdata-team-catalog',
            leaseOwnerToken: null,
            leaseExpiresAt: null,
            pauseRequestedAt: status === 'PAUSED' ? null : owned.pauseRequestedAt,
            currentPhase: status === 'READY' ? 'READY' : status === 'PAUSED' ? 'PAUSED' : 'QUEUED',
            heartbeatAt,
            completedAt: status === 'READY' ? heartbeatAt : null,
            sourceTotal: page.count,
            matchedCount,
            scannedCount: { increment: scannedIds.length },
            addedCount: { increment: added },
            updatedCount: { increment: updated },
            missingCount,
            failedCount: { increment: failures.length },
            currentOffset: nextOffset,
            chunkIndex: { increment: 1 },
            completionReason
          }
        });
        if (committed.count !== 1) {
          throw new PesdataTeamChunkError('PESDATA_TEAM_SYNC_LEASE_LOST', 'Team synchronization lease ownership was lost');
        }
        return {
          disposition: status === 'PENDING' ? 'CONTINUE' : 'STOP', status, completionReason
        } satisfies SyncChunkOutcome;
      }, { timeout: 15_000 });
    } catch (error) {
      await this.prisma.teamCatalogSyncRun.updateMany({
        where: { id: runId, status: 'RUNNING', leaseOwnerToken },
        data: {
          status: 'FAILED', activeLeaseKey: null, leaseOwnerToken: null, leaseExpiresAt: null,
          currentPhase: 'FAILED', errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'PESDATA_TEAM_SYNC_FAILED',
          errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 512), completedAt: new Date()
        }
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }
}
