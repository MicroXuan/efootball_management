import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage.js';
import { MatchResultEventsService } from './match-result-events.service.js';
import { EVIDENCE_RETAINED_PREFIX, evidenceOrphanKeys, evidenceSourceKeys } from '../storage/evidence-object-keys.js';

@Injectable()
export class ResultEvidenceRetentionWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ResultEvidenceRetentionWorker.name);
  private readonly events = new MatchResultEventsService();
  private timer?: NodeJS.Timeout;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}
  onApplicationBootstrap() {
    this.timer = setInterval(() => { void this.cleanup().catch((error: unknown) => this.logger.error('Evidence cleanup failed', error)); }, 86_400_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async cleanup(now = new Date()): Promise<void> {
    let after = '';
    for (;;) {
      const batch = await this.prisma.matchResultEvidence.findMany({ where: {
        id: { gt: after }, status: { in: ['ACTIVE', 'PENDING_DELETE'] }, expiresAt: { lte: now }
      }, select: { id: true, matchId: true }, orderBy: { id: 'asc' }, take: 100 });
      if (!batch.length) break;
      for (const candidate of batch) {
        after = candidate.id;
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
    }
    after = '';
    const cutoff = new Date(now.getTime() - 86_400_000);
    for (;;) {
      const batch = await this.prisma.matchResultEvidenceUpload.findMany({ where: {
        // Revisit expired sessions: an in-flight provider write can finish after a DB timeout.
        id: { gt: after }, status: { in: ['PENDING', 'UPLOADED', 'EXPIRED'] }, createdAt: { lt: cutoff },
        resultVersionId: null, disputeId: null, evidence: null
      }, select: { id: true, matchId: true }, orderBy: { id: 'asc' }, take: 100 });
      if (!batch.length) break;
      for (const candidate of batch) {
        after = candidate.id;
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
    }
    // Completion can persist the retained key before source deletion fails. Consumption
    // removes these sessions from orphan cleanup, so revisit their source siblings daily.
    after = '';
    for (;;) {
      const batch = await this.prisma.matchResultEvidenceUpload.findMany({ where: {
        id: { gt: after }, objectKey: { contains: EVIDENCE_RETAINED_PREFIX }, createdAt: { lt: cutoff },
        OR: [{ status: 'CONSUMED' }, { evidence: { isNot: null } },
          { resultVersionId: { not: null } }, { disputeId: { not: null } }]
      }, select: { id: true, matchId: true }, orderBy: { id: 'asc' }, take: 100 });
      if (!batch.length) break;
      for (const candidate of batch) {
        after = candidate.id;
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
    }
  }
}
