import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage.js';
import { MatchResultEventsService } from './match-result-events.service.js';
import { EVIDENCE_RETAINED_PREFIX, evidenceOrphanKeys, evidenceSourceKeys } from '../storage/evidence-object-keys.js';

@Injectable()
export class ResultEvidenceRetentionWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private static readonly RUN_BUDGET = 100;
  private static readonly PHASE_BUDGETS = {
    evidence: Math.ceil(ResultEvidenceRetentionWorker.RUN_BUDGET / 3),
    orphan: Math.floor(ResultEvidenceRetentionWorker.RUN_BUDGET / 3),
    source: ResultEvidenceRetentionWorker.RUN_BUDGET
      - Math.ceil(ResultEvidenceRetentionWorker.RUN_BUDGET / 3)
      - Math.floor(ResultEvidenceRetentionWorker.RUN_BUDGET / 3)
  } as const;
  private readonly logger = new Logger(ResultEvidenceRetentionWorker.name);
  private readonly events = new MatchResultEventsService();
  private timer?: NodeJS.Timeout;
  private activeCleanup: Promise<void> | undefined;
  private evidenceCursor = '';
  private orphanCursor = '';
  private sourceCursor = '';
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}
  onApplicationBootstrap() {
    this.timer = setInterval(() => { void this.cleanup().catch((error: unknown) => this.logger.error('Evidence cleanup failed', error)); }, 86_400_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  cleanup(now = new Date()): Promise<void> {
    if (this.activeCleanup) return this.activeCleanup;
    const run = this.cleanupPass(now).finally(() => {
      if (this.activeCleanup === run) this.activeCleanup = undefined;
    });
    this.activeCleanup = run;
    return run;
  }

  private async cleanupPass(now: Date): Promise<void> {
    let evidenceRemaining = ResultEvidenceRetentionWorker.PHASE_BUDGETS.evidence;
    while (evidenceRemaining > 0) {
      const batch = await this.prisma.matchResultEvidence.findMany({ where: {
        id: { gt: this.evidenceCursor }, status: { in: ['ACTIVE', 'PENDING_DELETE'] }, expiresAt: { lte: now }
      }, select: { id: true, matchId: true }, orderBy: { id: 'asc' }, take: evidenceRemaining });
      if (!batch.length) { this.evidenceCursor = ''; break; }
      const requested = evidenceRemaining;
      for (const candidate of batch) {
        this.evidenceCursor = candidate.id;
        evidenceRemaining -= 1;
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM competition_matches WHERE id = ${candidate.matchId} FOR UPDATE`;
            const evidence = await tx.matchResultEvidence.findUnique({ where: { id: candidate.id }, include: { dispute: true, match: true } });
            if (!evidence || evidence.status === 'DELETED' || !evidence.expiresAt || evidence.expiresAt > now) return;
            const unresolved = await tx.matchResultDispute.count({ where: { matchId: candidate.matchId, status: { in: ['EVIDENCE_COLLECTION', 'READY_FOR_REVIEW'] } } });
            if (unresolved || (evidence.dispute && !['RESOLVED', 'CANCELLED'].includes(evidence.dispute.status))) return;
            if (evidence.status === 'ACTIVE' && evidence.dispute?.status !== 'RESOLVED'
              && !['CONFIRMED', 'ADMIN_DECIDED'].includes(evidence.match.status)) return;
            // Keep the match lock through storage deletion: a concurrent attachment/decision must wait.
            // Object deletion is idempotent; a DB rollback after deletion is safe to retry.
            await this.storage.delete(evidence.objectKey);
            await tx.matchResultEvidence.update({ where: { id: evidence.id }, data: { status: 'DELETED', deletedAt: now } });
            await this.events.append(tx, { matchId: evidence.matchId, disputeId: evidence.disputeId, resultVersionId: evidence.resultVersionId,
              type: 'EVIDENCE_DELETED', actorType: 'SYSTEM', occurredAt: now, eventKey: `evidence:${evidence.id}:deleted`, metadata: { evidenceId: evidence.id } });
          });
        } catch (error) { this.logger.warn(`Evidence ${candidate.id} cleanup will retry: ${String(error)}`); }
      }
      if (batch.length < requested) { this.evidenceCursor = ''; break; }
    }
    const cutoff = new Date(now.getTime() - 86_400_000);
    let orphanRemaining = ResultEvidenceRetentionWorker.PHASE_BUDGETS.orphan;
    while (orphanRemaining > 0) {
      const batch = await this.prisma.matchResultEvidenceUpload.findMany({ where: {
        // Revisit expired sessions: an in-flight provider write can finish after a DB timeout.
        id: { gt: this.orphanCursor }, status: { in: ['PENDING', 'UPLOADED', 'EXPIRED'] }, createdAt: { lt: cutoff },
        resultVersionId: null, disputeId: null, evidence: null
      }, select: { id: true, matchId: true }, orderBy: { id: 'asc' }, take: orphanRemaining });
      if (!batch.length) { this.orphanCursor = ''; break; }
      const requested = orphanRemaining;
      for (const candidate of batch) {
        this.orphanCursor = candidate.id;
        orphanRemaining -= 1;
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM competition_matches WHERE id = ${candidate.matchId} FOR UPDATE`;
            const upload = await tx.matchResultEvidenceUpload.findUnique({ where: { id: candidate.id }, include: { evidence: true } });
            if (!upload || !['PENDING', 'UPLOADED', 'EXPIRED'].includes(upload.status) || upload.createdAt >= cutoff
              || upload.evidence || upload.resultVersionId || upload.disputeId || upload.expiresAt > now) return;
            // Legacy evidence may reference the object without the optional uploadId relation.
            const keys = evidenceOrphanKeys(upload.objectKey);
            for (const objectKey of keys) {
              if (await tx.matchResultEvidence.findUnique({ where: { objectKey } })) return;
            }
            for (const objectKey of keys) await this.storage.delete(objectKey);
            if (upload.status !== 'EXPIRED') await tx.matchResultEvidenceUpload.update({ where: { id: upload.id }, data: { status: 'EXPIRED' } });
          });
        } catch (error) { this.logger.warn(`Upload ${candidate.id} cleanup will retry: ${String(error)}`); }
      }
      if (batch.length < requested) { this.orphanCursor = ''; break; }
    }
    // Completion can persist the retained key before source deletion fails. Consumption
    // removes these sessions from orphan cleanup, so revisit their source siblings daily.
    let sourceRemaining = ResultEvidenceRetentionWorker.PHASE_BUDGETS.source;
    while (sourceRemaining > 0) {
      const batch = await this.prisma.matchResultEvidenceUpload.findMany({ where: {
        id: { gt: this.sourceCursor }, objectKey: { contains: EVIDENCE_RETAINED_PREFIX }, createdAt: { lt: cutoff },
        OR: [{ status: 'CONSUMED' }, { evidence: { isNot: null } },
          { resultVersionId: { not: null } }, { disputeId: { not: null } }]
      }, select: { id: true, matchId: true }, orderBy: { id: 'asc' }, take: sourceRemaining });
      if (!batch.length) { this.sourceCursor = ''; break; }
      const requested = sourceRemaining;
      for (const candidate of batch) {
        this.sourceCursor = candidate.id;
        sourceRemaining -= 1;
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM competition_matches WHERE id = ${candidate.matchId} FOR UPDATE`;
            const upload = await tx.matchResultEvidenceUpload.findUnique({ where: { id: candidate.id }, include: { evidence: true } });
            if (!upload || upload.createdAt >= cutoff || upload.expiresAt > now
              || (upload.status !== 'CONSUMED' && !upload.evidence && !upload.resultVersionId && !upload.disputeId)) return;
            const keys = evidenceSourceKeys(upload.objectKey);
            if (!keys.length) return;
            // Exact-key checks across both tables protect legacy/cross-match collisions.
            // Batch the sibling lookups, rather than issuing one query per source key.
            const evidenceReferences = await tx.matchResultEvidence.findMany({ where: { objectKey: { in: keys } }, select: { objectKey: true } });
            const uploadReferences = await tx.matchResultEvidenceUpload.findMany({ where: { objectKey: { in: keys } }, select: { objectKey: true } });
            const referenced = new Set([...evidenceReferences, ...uploadReferences].map((row) => row.objectKey));
            // Never remove the retained object. Not-found is provider-idempotent; errors
            // leave the durable session eligible for the next daily retry (no migration).
            for (const objectKey of keys) if (!referenced.has(objectKey)) await this.storage.delete(objectKey);
          });
        } catch (error) { this.logger.warn(`Upload ${candidate.id} source cleanup will retry: ${String(error)}`); }
      }
      if (batch.length < requested) { this.sourceCursor = ''; break; }
    }
  }
}
