import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { PlayerImportPublisher } from '../player-import/player-import.publisher.js';

@Injectable()
export class PlayerCatalogReconciliationReview {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(PlayerImportPublisher) private readonly publisher: PlayerImportPublisher
  ) {}

  async report(adminId: string, runId: string, page = 1, pageSize = 20) {
    await this.authorization.requirePlatformAdmin(adminId);
    const run = await this.prisma.externalSyncRun.findUnique({ where: { id: runId } });
    if (!run || run.mode !== 'RECONCILE') throw new NotFoundException('RECONCILIATION_NOT_FOUND');
    const [groups, total, items, publicActive] = await Promise.all([
      this.prisma.playerCatalogReconciliationItem.groupBy({
        by: ['changeType'], where: { runId }, _count: { changeType: true }
      }),
      this.prisma.playerCatalogReconciliationItem.count({ where: { runId } }),
      this.prisma.playerCatalogReconciliationItem.findMany({
        where: { runId }, orderBy: [{ changeType: 'asc' }, { externalId: 'asc' }],
        skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, externalId: true, displayName: true, changeType: true,
          reason: true, evidenceJson: true, batchId: true, publishedAt: true }
      }),
      this.prisma.playerCard.count({ where: { sourceId: run.sourceId, status: 'ACTIVE', publishedAt: { not: null } } })
    ]);
    const counts = Object.fromEntries(groups.map((group) => [group.changeType, group._count.changeType]));
    if (run.errorCode === 'REMOVAL_ANOMALY') counts.REMOVAL_CANDIDATE = run.skippedCount;
    return {
      runId, status: run.status, phase: run.currentPhase, trusted: run.scanTrusted,
      warningCode: run.errorCode,
      sourceTotal: run.sourceTotal, publicActive, businessDate: run.businessDate?.toISOString().slice(0, 10) ?? null,
      startedAt: run.startedAt?.toISOString() ?? null, finishedAt: run.finishedAt?.toISOString() ?? null,
      counts,
      page, pageSize, total,
      items: items.map((item) => ({ ...item, publishedAt: item.publishedAt?.toISOString() ?? null }))
    };
  }

  async publishValid(adminId: string, runId: string): Promise<{ published: number; skipped: number; failed: number;
    remaining: number; failures: Array<{ batchId: string; reason: string }> }> {
    await this.authorization.requirePlatformAdmin(adminId);
    const run = await this.prisma.externalSyncRun.findUnique({ where: { id: runId } });
    if (!run || run.mode !== 'RECONCILE') throw new NotFoundException('RECONCILIATION_NOT_FOUND');
    if (run.status !== 'READY' || !run.scanTrusted) throw new ConflictException('SCAN_NOT_TRUSTED');
    const latest = await this.prisma.externalSyncRun.findFirst({
      where: { sourceId: run.sourceId, mode: 'RECONCILE', status: 'READY', scanTrusted: true },
      orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }], select: { id: true }
    });
    if (latest?.id !== runId) throw new ConflictException('RECONCILIATION_SUPERSEDED');
    const token = randomUUID();
    const now = new Date();
    const active = await this.prisma.externalSyncRun.findUnique({ where: { activeLeaseKey: 'pesdata' },
      select: { id: true } });
    if (active) throw new ConflictException('PESDATA_SYNC_IN_PROGRESS');
    const locked = await this.prisma.externalSyncRun.updateMany({
      where: { id: runId, status: 'READY', scanTrusted: true, activeLeaseKey: null, OR: [
        { leaseOwnerToken: null }, { leaseExpiresAt: { lt: now } }
      ] },
      data: { activeLeaseKey: 'pesdata', leaseOwnerToken: token,
        leaseExpiresAt: new Date(now.getTime() + 10 * 60_000), currentPhase: 'PUBLISHING' }
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('PESDATA_SYNC_IN_PROGRESS');
      }
      throw error;
    });
    if (locked.count !== 1) throw new ConflictException('RECONCILIATION_PUBLISH_IN_PROGRESS');
    const result = { published: 0, skipped: 0, failed: 0, remaining: 0,
      failures: [] as Array<{ batchId: string; reason: string }> };
    let unresolved = 0;
    try {
      const links = await this.prisma.externalSyncRunBatch.findMany({
        where: { runId }, include: { batch: true }, orderBy: { chunkIndex: 'asc' }
      });
      let attempted = false;
      for (const link of links) {
        const batch = link.batch;
        if (batch.status === 'PUBLISHED') {
          await this.markBatchPublished(runId, run.sourceId, batch.id);
          continue;
        }
        if (batch.status !== 'READY' || batch.invalidCount > 0) { result.skipped += 1; continue; }
        const invalidItems = await this.prisma.playerCatalogReconciliationItem.count({
          where: { runId, batchId: batch.id, changeType: { notIn: ['ADDED', 'UPDATED', 'UNCHANGED', 'REMOVAL_CONFIRMED'] } }
        });
        if (invalidItems > 0) { result.skipped += 1; continue; }
        if (attempted) { result.remaining += 1; continue; }
        attempted = true;
        try {
          const published = await this.publisher.publishForPlatformAdmin(adminId, batch.id, runId);
          if (published.status !== 'PUBLISHED') throw new Error('PUBLISH_NOT_CONFIRMED');
          await this.markBatchPublished(runId, run.sourceId, batch.id);
          result.published += 1;
        } catch (error) {
          result.failed += 1;
          result.remaining += 1;
          result.failures.push({ batchId: batch.id,
            reason: error instanceof Error ? error.message.slice(0, 256) : 'Unknown publication failure' });
        }
      }
      unresolved = await this.prisma.playerCatalogReconciliationItem.count({
        where: { runId, OR: [
          { changeType: { in: ['REMOVAL_CANDIDATE', 'FAILED'] } },
          { changeType: { in: ['ADDED', 'UPDATED', 'REMOVAL_CONFIRMED'] }, publishedAt: null }
        ] }
      });
      if (!result.remaining && !unresolved && !result.skipped && !result.failed
        && run.errorCode !== 'REMOVAL_ANOMALY') {
        const publicActive = await this.prisma.playerCard.count({
          where: { sourceId: run.sourceId, status: 'ACTIVE', publishedAt: { not: null } }
        });
        if (run.sourceTotal !== publicActive || !await this.publishedIdsMatch(runId, run.sourceId)) {
          unresolved += 1;
        }
      }
      return result;
    } finally {
      await this.prisma.externalSyncRun.updateMany({
        where: { id: runId, leaseOwnerToken: token },
        data: { activeLeaseKey: null, leaseOwnerToken: null, leaseExpiresAt: null,
          ...(run.errorCode === 'PUBLISH_INTERRUPTED' ? { errorCode: null } : {}),
          currentPhase: result.failed || result.skipped || result.remaining || unresolved || run.errorCode === 'REMOVAL_ANOMALY'
            ? 'PARTIALLY_PUBLISHED' : 'PUBLISHED' }
      });
    }
  }

  private async markBatchPublished(runId: string, sourceId: string, batchId: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE player_cards card
      JOIN player_catalog_reconciliation_items item ON item.external_id = card.external_id
      SET card.published_summary_checksum = item.summary_checksum,
        card.last_detail_audit_at = ${new Date()}
      WHERE card.source_id = ${sourceId} AND item.run_id = ${runId}
        AND item.batch_id = ${batchId} AND item.published_at IS NULL
        AND item.change_type IN ('ADDED', 'UPDATED', 'UNCHANGED')
        AND item.summary_checksum IS NOT NULL
    `);
    await this.prisma.playerCatalogReconciliationItem.updateMany({
      where: { runId, batchId, publishedAt: null }, data: { publishedAt: new Date() }
    });
  }

  private async publishedIdsMatch(runId: string, sourceId: string): Promise<boolean> {
    const missing = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count FROM player_catalog_scan_entries scanned
      LEFT JOIN player_cards card ON card.source_id = ${sourceId}
        AND card.external_id = scanned.external_id AND card.status = 'ACTIVE'
        AND card.published_at IS NOT NULL
      WHERE scanned.run_id = ${runId} AND scanned.pass = 2 AND card.id IS NULL
    `);
    if (Number(missing[0]?.count ?? 0) > 0) return false;
    const extra = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count FROM player_cards card
      LEFT JOIN player_catalog_scan_entries scanned ON scanned.run_id = ${runId}
        AND scanned.pass = 2 AND scanned.external_id = card.external_id
      WHERE card.source_id = ${sourceId} AND card.status = 'ACTIVE'
        AND card.published_at IS NOT NULL AND scanned.external_id IS NULL
    `);
    return Number(extra[0]?.count ?? 0) === 0;
  }
}
