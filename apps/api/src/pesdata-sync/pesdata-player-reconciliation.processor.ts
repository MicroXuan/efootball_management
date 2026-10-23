import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { ExternalSyncRun } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerImportService, toExistingRecord } from '../player-import/player-import.service.js';
import { normalizeImportRow } from '../player-import/record-normalizer.js';
import { PesdataClient } from './pesdata-client.js';
import { mapPesdataPlayer } from './pesdata-mapper.js';
import { PlayerCatalogScanRepository } from './player-catalog-scan.repository.js';
import { classifyMissingCard } from './player-catalog-reconciliation.rules.js';
import { PesdataSyncError, type SyncChunkOutcome } from './pesdata-sync.types.js';
import { SYNC_HEARTBEAT_INTERVAL_MS, SYNC_LEASE_MS } from '../platform-data-sync/platform-data-sync.constants.js';

type Phase = 'SCAN_PASS_1' | 'SCAN_PASS_2' | 'DIFF_SOURCE' | 'DIFF_MISSING';
type NextStep = {
  phase: Phase | 'READY';
  offset: number;
  cursor?: string | null;
  scanned: number;
  fetched: number;
  failed: number;
  skipped?: number;
  warningCode?: string;
  warningMessage?: string;
  sourceTotal?: number;
  scanTrusted?: boolean;
};
export const PESDATA_RECONCILIATION_OPTIONS = Symbol('PESDATA_RECONCILIATION_OPTIONS');

@Injectable()
export class PesdataPlayerReconciliationProcessor {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerImportService) private readonly imports: PlayerImportService,
    @Inject(PesdataClient) private readonly client: PesdataClient,
    @Inject(PlayerCatalogScanRepository) private readonly scans: PlayerCatalogScanRepository,
    @Optional() @Inject(PESDATA_RECONCILIATION_OPTIONS)
    private readonly options: { maxMissingPercent?: number } = {}
  ) {}

  async processNextChunk(runId: string): Promise<SyncChunkOutcome> {
    const leaseOwnerToken = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.externalSyncRun.updateMany({
      where: { id: runId, mode: 'RECONCILE', status: 'PENDING', activeLeaseKey: 'pesdata', leaseOwnerToken: null },
      data: {
        status: 'RUNNING', leaseOwnerToken, startedAt: now, heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + SYNC_LEASE_MS)
      }
    });
    if (claimed.count !== 1) {
      const run = await this.prisma.externalSyncRun.findUnique({ where: { id: runId } });
      if (run?.status === 'READY') return { disposition: 'STOP', status: 'READY', completionReason: run.completionReason };
      throw new PesdataSyncError('PESDATA_SYNC_CONFLICT', 'Reconciliation chunk is unavailable');
    }
    const run = await this.prisma.externalSyncRun.findUniqueOrThrow({ where: { id: runId } });
    let heartbeatFailure = false;
    const heartbeat = setInterval(() => {
      const time = new Date();
      void this.prisma.externalSyncRun.updateMany({
        where: { id: runId, status: 'RUNNING', leaseOwnerToken, leaseExpiresAt: { gt: time } },
        data: { heartbeatAt: time, leaseExpiresAt: new Date(time.getTime() + SYNC_LEASE_MS) }
      }).then(({ count }) => { if (count !== 1) heartbeatFailure = true; })
        .catch(() => { heartbeatFailure = true; });
    }, SYNC_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();
    try {
      const phase = (run.currentPhase ?? 'SCAN_PASS_1') as Phase;
      const next: NextStep = phase === 'SCAN_PASS_1' || phase === 'SCAN_PASS_2'
        ? await this.scanPage(run, phase)
        : phase === 'DIFF_SOURCE'
          ? await this.diffSource(run)
          : await this.diffMissing(run);
      if (heartbeatFailure) throw new PesdataSyncError('PESDATA_SYNC_LEASE_LOST', 'Heartbeat failed');
      const finished = next.phase === 'READY';
      const status = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM external_sync_runs WHERE id = ${runId} FOR UPDATE`);
        const current = await tx.externalSyncRun.findUniqueOrThrow({ where: { id: runId } });
        const paused = !finished && current.pauseRequestedAt !== null;
        const nextStatus = finished ? 'READY' as const : paused ? 'PAUSED' as const : 'PENDING' as const;
        const changed = await tx.externalSyncRun.updateMany({
          where: { id: runId, status: 'RUNNING', leaseOwnerToken, leaseExpiresAt: { gt: new Date() } },
          data: {
            status: nextStatus, currentPhase: next.phase,
            activeLeaseKey: finished ? null : 'pesdata', leaseOwnerToken: null, leaseExpiresAt: null,
            pauseRequestedAt: null,
            currentOffset: next.offset, currentCursor: next.cursor ?? null,
            ...(next.sourceTotal === undefined ? {} : { sourceTotal: next.sourceTotal }),
            ...(next.scanTrusted === undefined ? {} : { scanTrusted: next.scanTrusted }),
            scannedCount: { increment: next.scanned }, fetchedCount: { increment: next.fetched },
            failedCount: { increment: next.failed }, chunkIndex: { increment: 1 }, heartbeatAt: new Date(),
            ...(next.skipped === undefined ? {} : { skippedCount: { increment: next.skipped } }),
            ...(next.warningCode === undefined ? {} : { errorCode: next.warningCode, errorMessage: next.warningMessage }),
            ...(finished ? { finishedAt: new Date(), completionReason: 'SOURCE_EXHAUSTED' as const } : {})
          }
        });
        if (changed.count !== 1) throw new PesdataSyncError('PESDATA_SYNC_LEASE_LOST', 'Lease ownership was lost');
        return nextStatus;
      });
      return { disposition: status === 'PENDING' ? 'CONTINUE' : 'STOP', status, completionReason: finished ? 'SOURCE_EXHAUSTED' : null };
    } catch (error) {
      await this.prisma.externalSyncRun.updateMany({
        where: { id: runId, status: 'RUNNING', leaseOwnerToken },
        data: {
          status: 'FAILED', activeLeaseKey: null, leaseOwnerToken: null, leaseExpiresAt: null,
          currentPhase: run.currentPhase, errorCode: error instanceof PesdataSyncError ? error.code : 'PESDATA_RECONCILIATION_FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 512) : 'Unknown reconciliation failure',
          finishedAt: new Date()
        }
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async scanPage(run: ExternalSyncRun, phase: 'SCAN_PASS_1' | 'SCAN_PASS_2') {
    const pass = phase === 'SCAN_PASS_1' ? 1 as const : 2 as const;
    const page = await this.client.listPlayers({ start: run.currentOffset, limit: run.chunkSize, order: 'DESC' });
    await this.scans.recordPage(run.id, pass, run.currentOffset, run.chunkSize, page.count, page.list);
    const offset = run.currentOffset + page.list.length;
    if (offset < page.count) return { phase, offset, scanned: page.list.length, fetched: 0, failed: 0, sourceTotal: page.count };
    if (pass === 1) return { phase: 'SCAN_PASS_2' as const, offset: 0, scanned: page.list.length, fetched: 0, failed: 0, sourceTotal: page.count };
    const verification = await this.scans.verify(run.id);
    if (!verification.trusted) throw new PesdataSyncError('PESDATA_SCAN_UNTRUSTED', verification.reason);
    return { phase: 'DIFF_SOURCE' as const, offset: 0, scanned: page.list.length, fetched: 0, failed: 0,
      sourceTotal: verification.sourceTotal, scanTrusted: true };
  }

  private async diffSource(run: ExternalSyncRun) {
    if (!run.scanTrusted) throw new PesdataSyncError('PESDATA_SCAN_UNTRUSTED', 'Scan was not verified');
    const entries = await this.prisma.playerCatalogScanEntry.findMany({
      where: { runId: run.id, pass: 2 }, orderBy: { externalId: 'asc' },
      skip: run.currentOffset, take: run.chunkSize
    });
    if (!entries.length) return { phase: 'DIFF_MISSING' as const, offset: 0, scanned: 0, fetched: 0, failed: 0 };
    const cards = await this.prisma.playerCard.findMany({
      where: { sourceId: run.sourceId, externalId: { in: entries.map(({ externalId }) => externalId) } },
      select: { externalId: true, status: true, publishedAt: true,
        publishedSummaryChecksum: true, lastDetailAuditAt: true }
    });
    const byId = new Map(cards.map((card) => [card.externalId, card]));
    const alreadyAudited = await this.prisma.playerCatalogReconciliationItem.count({
      where: { runId: run.id, reason: { in: ['ROLLING_AUDIT', 'ROLLING_AUDIT_FAILED'] } }
    });
    let auditRemaining = Math.max(0, 500 - alreadyAudited);
    const fetched: Array<{ externalId: string; summaryChecksum: string; displayName: string | null; normalized: ReturnType<typeof normalizeImportRow>; reason: string }> = [];
    const failures: Array<{ externalId: string; summaryChecksum: string; displayName: string | null;
      reason: string; error: string }> = [];
    for (const entry of entries) {
      const card = byId.get(entry.externalId);
      const changed = !card || card.status !== 'ACTIVE' || card.publishedAt === null
        || (card.publishedSummaryChecksum !== null
        && card.publishedSummaryChecksum !== entry.summaryChecksum);
      const auditDue = card && !changed && auditRemaining > 0
        && (!card.lastDetailAuditAt || card.lastDetailAuditAt.getTime() < Date.now() - 90 * 86_400_000);
      if (!changed && !auditDue) continue;
      if (auditDue) auditRemaining -= 1;
      try {
        const detail = await this.client.getPlayerDetail(entry.externalId);
        const normalized = normalizeImportRow(mapPesdataPlayer(detail));
        fetched.push({ externalId: entry.externalId, summaryChecksum: entry.summaryChecksum,
          displayName: entry.displayName, normalized, reason: auditDue ? 'ROLLING_AUDIT' : 'SOURCE_CHANGE' });
      } catch (error) {
        failures.push({ externalId: entry.externalId, summaryChecksum: entry.summaryChecksum,
          displayName: entry.displayName, reason: auditDue ? 'ROLLING_AUDIT_FAILED' : 'DETAIL_FETCH_FAILED',
          error: error instanceof Error ? error.message.slice(0, 512) : 'Detail unavailable' });
      }
    }
    let invalidCount = 0;
    if (fetched.length) {
      const outcome = await this.prisma.$transaction((tx) => this.imports.createBatchForPlatformAdminInTransaction(tx, run.actorId, {
        sourceCode: 'pesdata', fileName: `pesdata-reconcile-${run.id}-${run.chunkIndex + 1}.json`,
        format: 'JSON', content: JSON.stringify(fetched.map(({ normalized }) => normalized))
      }, `${run.id}:source:${run.chunkIndex + 1}`), { timeout: 60_000 });
      const records = await this.prisma.importRecord.findMany({
        where: { batchId: outcome.batch.id }, orderBy: { rowNumber: 'asc' }, select: { diffType: true }
      });
      const validFetched = fetched.filter((_, index) => records[index]?.diffType !== 'INVALID');
      invalidCount = fetched.length - validFetched.length;
      let publishBatchId: string | null = outcome.batch.id;
      if (validFetched.length !== fetched.length) {
        const validBatch = validFetched.length ? await this.prisma.$transaction((tx) =>
          this.imports.createBatchForPlatformAdminInTransaction(tx, run.actorId, {
          sourceCode: 'pesdata', fileName: `pesdata-reconcile-valid-${run.id}-${run.chunkIndex + 1}.json`,
          format: 'JSON', content: JSON.stringify(validFetched.map(({ normalized }) => normalized))
          }, `${run.id}:source-valid:${run.chunkIndex + 1}`), { timeout: 60_000 }) : null;
        if (validBatch && validBatch.batch.status !== 'READY') {
          throw new PesdataSyncError('PESDATA_RECONCILIATION_INVALID_BATCH', 'Valid rows were not publishable');
        }
        publishBatchId = validBatch?.batch.id ?? null;
      }
      if (publishBatchId) await this.prisma.externalSyncRunBatch.upsert({
        where: { runId_batchId: { runId: run.id, batchId: publishBatchId } },
        update: {}, create: { runId: run.id, batchId: publishBatchId, chunkIndex: run.chunkIndex + 1 }
      });
      await this.prisma.playerCatalogReconciliationItem.createMany({ data: fetched.map((item, index) => ({
        runId: run.id, externalId: item.externalId, summaryChecksum: item.summaryChecksum,
        displayName: item.displayName, normalizedJson: item.normalized as Prisma.InputJsonValue,
        changeType: records[index]?.diffType === 'CREATE' ? 'ADDED'
          : records[index]?.diffType === 'UPDATE' ? 'UPDATED'
            : records[index]?.diffType === 'UNCHANGED' ? 'UNCHANGED' : 'FAILED',
        reason: records[index]?.diffType === 'INVALID' ? 'Import validation failed' : item.reason,
        batchId: records[index]?.diffType === 'INVALID' ? null : publishBatchId
      })), skipDuplicates: true });
      const unchanged = fetched.filter((_, index) => records[index]?.diffType === 'UNCHANGED');
      for (const item of unchanged) {
        await this.prisma.playerCard.updateMany({
          where: { sourceId: run.sourceId, externalId: item.externalId },
          data: { publishedSummaryChecksum: item.summaryChecksum, lastDetailAuditAt: new Date() }
        });
      }
    }
    if (failures.length) await this.prisma.playerCatalogReconciliationItem.createMany({
      data: failures.map((item) => ({ runId: run.id, externalId: item.externalId,
        summaryChecksum: item.summaryChecksum, displayName: item.displayName,
        changeType: 'FAILED', reason: item.reason,
        evidenceJson: { error: item.error } })), skipDuplicates: true
    });
    return { phase: 'DIFF_SOURCE' as const, offset: run.currentOffset + entries.length,
      scanned: 0, fetched: fetched.length, failed: failures.length + invalidCount };
  }

  private async diffMissing(run: ExternalSyncRun) {
    if (!run.scanTrusted) throw new PesdataSyncError('PESDATA_SCAN_UNTRUSTED', 'Scan was not verified');
    const activeCount = await this.prisma.playerCard.count({
      where: { sourceId: run.sourceId, status: 'ACTIVE', publishedAt: { not: null } }
    });
    const missingRows = await this.prisma.$queryRaw<Array<{ missing: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS missing FROM player_cards card
      LEFT JOIN player_catalog_scan_entries source_card
        ON source_card.run_id = ${run.id} AND source_card.pass = 2
        AND source_card.external_id = card.external_id
      WHERE card.source_id = ${run.sourceId} AND card.status = 'ACTIVE'
        AND card.published_at IS NOT NULL AND source_card.external_id IS NULL
    `);
    const missingCount = Number(missingRows[0]?.missing ?? 0);
    const anomaly = (run.sourceTotal === 0 && activeCount > 0)
      || (activeCount > 0 && missingCount * 100 / activeCount > (this.options.maxMissingPercent ?? 20));
    if (anomaly) return { phase: 'READY' as const, offset: 0, scanned: 0, fetched: 0, failed: 0,
      skipped: missingCount, warningCode: 'REMOVAL_ANOMALY',
      warningMessage: `${missingCount} published cards absent; removals paused` };
    const rows = await this.prisma.$queryRaw<Array<{ externalId: string; cardName: string }>>(Prisma.sql`
      SELECT card.external_id AS externalId, card.card_name AS cardName FROM player_cards card
      LEFT JOIN player_catalog_scan_entries source_card
        ON source_card.run_id = ${run.id} AND source_card.pass = 2
        AND source_card.external_id = card.external_id
      WHERE card.source_id = ${run.sourceId} AND card.status = 'ACTIVE'
        AND card.published_at IS NOT NULL AND source_card.external_id IS NULL
        AND card.external_id > ${run.currentCursor ?? ''}
      ORDER BY card.external_id ASC LIMIT ${run.chunkSize}
    `);
    if (!rows.length) return { phase: 'READY' as const, offset: 0, scanned: 0, fetched: 0, failed: 0 };
    const today = run.businessDate?.toISOString().slice(0, 10);
    if (!today) throw new PesdataSyncError('PESDATA_BUSINESS_DATE_MISSING', 'Run has no business date');
    const previousDate = new Date(`${today}T00:00:00.000Z`);
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    const previous = await this.prisma.externalSyncRun.findFirst({
      where: { sourceId: run.sourceId, mode: 'RECONCILE', scanTrusted: true, status: 'READY',
        businessDate: previousDate },
      orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }], select: { id: true, errorCode: true }
    });
    const confirmed: Array<{ externalId: string; normalized: ReturnType<typeof toExistingRecord> }> = [];
    const items: Array<{ runId: string; externalId: string; displayName: string; changeType: string;
      reason: string; evidenceJson: Prisma.InputJsonValue }> = [];
    for (const row of rows) {
      let detail: 'FOUND' | 'CONFIRMED_ABSENT' | 'UNKNOWN' = 'UNKNOWN';
      if (!anomaly) {
        try {
          const source = await this.client.getPlayerDetail(row.externalId);
          detail = String(source.is_del ?? '0') === '1' ? 'CONFIRMED_ABSENT' : 'FOUND';
        } catch { detail = 'UNKNOWN'; }
      }
      const previousMissing = previous && previous.errorCode !== 'REMOVAL_ANOMALY' ? !await this.prisma.playerCatalogScanEntry.findUnique({
        where: { runId_pass_externalId: { runId: previous.id, pass: 2, externalId: row.externalId } },
        select: { externalId: true }
      }) : false;
      const decision = anomaly ? 'REMOVAL_CANDIDATE'
        : classifyMissingCard({ today, previousTrustedDate: previous ? previousDate.toISOString().slice(0, 10) : null,
          previousMissing, detail });
      const changeType = decision === 'CONFLICT' ? 'REMOVAL_CANDIDATE' : decision;
      const reason = anomaly ? 'ANOMALOUS_MISSING_RATE' : detail === 'FOUND' ? 'DETAIL_STILL_ACTIVE'
        : detail === 'CONFIRMED_ABSENT' ? 'EXPLICIT_SOURCE_DELETION'
          : previousMissing ? 'TWO_ADJACENT_TRUSTED_DAYS' : 'FIRST_TRUSTED_MISSING_DAY';
      items.push({ runId: run.id, externalId: row.externalId, displayName: row.cardName,
        changeType, reason, evidenceJson: { today, previousRunId: previous?.id ?? null, detail } });
      if (changeType === 'REMOVAL_CONFIRMED') {
        const card = await this.prisma.playerCard.findUniqueOrThrow({
          where: { sourceId_externalId: { sourceId: run.sourceId, externalId: row.externalId } },
          include: { player: { include: { sources: { where: { sourceId: run.sourceId } } } },
            cardPack: true, attributes: true, skills: { include: { skill: true } } }
        });
        confirmed.push({ externalId: row.externalId, normalized: { ...toExistingRecord(card), status: 'INACTIVE' } });
      }
    }
    let batchId: string | null = null;
    if (confirmed.length) {
      const outcome = await this.prisma.$transaction((tx) => this.imports.createBatchForPlatformAdminInTransaction(tx, run.actorId, {
        sourceCode: 'pesdata', fileName: `pesdata-removals-${run.id}-${run.chunkIndex + 1}.json`,
        format: 'JSON', content: JSON.stringify(confirmed.map(({ normalized }) => normalized))
      }, `${run.id}:removals:${run.chunkIndex + 1}`), { timeout: 60_000 });
      batchId = outcome.batch.id;
      await this.prisma.externalSyncRunBatch.upsert({
        where: { runId_batchId: { runId: run.id, batchId } }, update: {},
        create: { runId: run.id, batchId, chunkIndex: run.chunkIndex + 1 }
      });
    }
    await this.prisma.playerCatalogReconciliationItem.createMany({
      data: items.map((item) => ({ ...item,
        ...(item.changeType === 'REMOVAL_CONFIRMED' ? { batchId } : {}) })), skipDuplicates: true
    });
    return { phase: 'DIFF_MISSING' as const, offset: 0, cursor: rows[rows.length - 1]!.externalId,
      scanned: 0, fetched: 0, failed: 0 };
  }
}
