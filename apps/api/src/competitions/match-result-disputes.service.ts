import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OpenTimeoutDisputeRequest, ParticipantMatchResultDisputeResponse } from '@efm/contracts';
import type { MatchResultDispute, MatchResultVersion, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError, assertExpectedVersion } from './competition.errors.js';
import type { CompetitionTransaction } from './competition.types.js';
import { MatchResultEventsService } from './match-result-events.service.js';
import { MutationReceiptService } from './mutation-receipt.service.js';

const EVIDENCE_WINDOW_MS = 86_400_000;
const participantInclude = {
  stage: { include: { competition: { include: { season: { include: { league: true } } } } } },
  homeParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } },
  awayParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } }
} satisfies Prisma.CompetitionMatchInclude;

@Injectable()
export class MatchResultDisputesService {
  private readonly events: MatchResultEventsService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
    @Optional() @Inject(MatchResultEventsService) events?: MatchResultEventsService
  ) { this.events = events ?? new MatchResultEventsService(); }

  // Called by ResultsService inside its match-locked, version-checked rejection transaction.
  async openFromRejection(transaction: CompetitionTransaction, proposal: MatchResultVersion, userId: string, now: Date) {
    return this.createDispute(transaction, proposal, userId, 'REJECTED', now);
  }

  async openFromTimeout(userId: string, matchId: string, input: OpenTimeoutDisputeRequest, key: string, at?: Date): Promise<ParticipantMatchResultDisputeResponse> {
    await this.correctForParticipant(userId, matchId, at);
    return this.receipts.execute(userId, `match.dispute.timeout:${matchId}`, key, async (transaction) => {
      await this.lockMatch(transaction, matchId);
      const match = await this.participantMatch(transaction, userId, matchId);
      assertExpectedVersion(match.version, input.expectedVersion, 'Match');
      const now = at ?? new Date();
      await this.advanceMatch(transaction, matchId, now);
      if (match.status !== 'PENDING_CONFIRMATION' || !match.resultConfirmationDeadlineAt || match.resultConfirmationDeadlineAt > now) {
        throw new CompetitionError('CONFIRMATION_NOT_EXPIRED', 'Confirmation has not expired', 409);
      }
      const proposal = await transaction.matchResultVersion.findFirst({ where: { matchId, status: 'PROPOSED' }, orderBy: { version: 'desc' } });
      if (!proposal || proposal.submittedById !== userId) {
        throw new CompetitionError('DISPUTE_SUBMITTER_REQUIRED', 'Only the original submitter may open a timeout dispute', 409);
      }
      const dispute = await this.createDispute(transaction, proposal, userId, 'CONFIRMATION_TIMEOUT', now);
      await this.consumeEvidence(transaction, dispute, userId, 'SUBMITTER', input.evidenceUploadId, now);
      await transaction.competitionMatch.update({ where: { id: matchId }, data: {
        status: 'DISPUTED', version: { increment: 1 }, resultConfirmationDeadlineAt: null
      } });
      return this.participantResponse(transaction, dispute, match.version + 1);
    });
  }

  async attachEvidence(userId: string, matchId: string, input: OpenTimeoutDisputeRequest, key: string, at?: Date): Promise<ParticipantMatchResultDisputeResponse> {
    // Commit deadline correction even if the subsequent upload/version validation fails.
    await this.correctForParticipant(userId, matchId, at);
    return this.receipts.execute(userId, `match.dispute.evidence:${matchId}`, key, async (transaction) => {
      await this.lockMatch(transaction, matchId);
      const match = await this.participantMatch(transaction, userId, matchId);
      assertExpectedVersion(match.version, input.expectedVersion, 'Match');
      const now = at ?? new Date();
      await this.advanceMatch(transaction, matchId, now);
      const dispute = await transaction.matchResultDispute.findUnique({ where: { activeKey: matchId } });
      if (!dispute || match.status !== 'DISPUTED') throw new CompetitionError('DISPUTE_NOT_FOUND', 'Active dispute was not found', 404);
      if (dispute.evidenceDeadlineAt <= now) throw new CompetitionError('EVIDENCE_DEADLINE_EXPIRED', 'Evidence collection has ended', 409);
      const proposal = await transaction.matchResultVersion.findUniqueOrThrow({ where: { id: dispute.triggerResultVersionId } });
      const role = proposal.submittedById === userId ? 'SUBMITTER' : 'OPPONENT';
      await this.consumeEvidence(transaction, dispute, userId, role, input.evidenceUploadId, now);
      const evidence = await transaction.matchResultEvidence.findMany({ where: { disputeId: dispute.id, status: 'ACTIVE' }, select: { role: true } });
      const bothPresent = ['SUBMITTER', 'OPPONENT'].every((value) => evidence.some(({ role: found }) => found === value));
      const updated = await transaction.matchResultDispute.update({ where: { id: dispute.id }, data: {
        status: bothPresent ? 'READY_FOR_REVIEW' : 'EVIDENCE_COLLECTION', version: { increment: 1 }
      } });
      await transaction.competitionMatch.update({ where: { id: matchId }, data: { version: { increment: 1 } } });
      return this.participantResponse(transaction, updated, match.version + 1);
    }).catch(async (error: unknown) => {
      // The deadline can pass after preflight while waiting for this transaction's lock.
      // Its failed write rolled back correction too; persist that transition separately.
      if (error instanceof CompetitionError && error.code === 'EVIDENCE_DEADLINE_EXPIRED') {
        await this.correctForParticipant(userId, matchId, at);
      }
      throw error;
    });
  }

  async getForParticipant(userId: string, matchId: string, at?: Date): Promise<ParticipantMatchResultDisputeResponse | null> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lockMatch(transaction, matchId);
      const match = await this.participantMatch(transaction, userId, matchId);
      await this.advanceMatch(transaction, matchId, at ?? new Date());
      const dispute = await transaction.matchResultDispute.findFirst({ where: { matchId }, orderBy: { createdAt: 'desc' } });
      return dispute ? this.participantResponse(transaction, dispute, match.version) : null;
    });
  }

  async advanceDue(now: Date = new Date()): Promise<void> {
    const due = await this.prisma.competitionMatch.findMany({ where: { OR: [
      { status: 'PENDING_CONFIRMATION', resultConfirmationDeadlineAt: { lte: now } },
      { resultDisputes: { some: { status: 'EVIDENCE_COLLECTION', evidenceDeadlineAt: { lte: now } } } }
    ] }, select: { id: true }, orderBy: { id: 'asc' } });
    for (const { id } of due) {
      await this.prisma.$transaction(async (transaction) => {
        await this.lockMatch(transaction, id);
        await this.advanceMatch(transaction, id, now);
      });
    }
  }

  // The caller holds the match row lock. Repeated corrections produce one event per transition.
  async advanceMatch(transaction: CompetitionTransaction, matchId: string, now: Date): Promise<void> {
    const match = await transaction.competitionMatch.findUnique({ where: { id: matchId } });
    if (!match) return;
    if (match.status === 'PENDING_CONFIRMATION' && match.resultConfirmationDeadlineAt && match.resultConfirmationDeadlineAt <= now) {
      const proposal = await transaction.matchResultVersion.findFirst({ where: { matchId, status: 'PROPOSED' }, orderBy: { version: 'desc' } });
      if (proposal) await this.events.append(transaction, {
        matchId, resultVersionId: proposal.id, type: 'CONFIRMATION_EXPIRED',
        eventKey: `result:${proposal.id}:confirmation-expired`, actorType: 'SYSTEM', occurredAt: match.resultConfirmationDeadlineAt
      });
    }
    const dispute = await transaction.matchResultDispute.findUnique({ where: { activeKey: matchId } });
    if (!dispute || dispute.status !== 'EVIDENCE_COLLECTION' || dispute.evidenceDeadlineAt > now) return;
    const evidence = await transaction.matchResultEvidence.findMany({ where: { disputeId: dispute.id, status: 'ACTIVE' }, select: { role: true } });
    const missingRoles = ['SUBMITTER', 'OPPONENT'].filter((role) => !evidence.some((entry) => entry.role === role));
    await transaction.matchResultDispute.update({ where: { id: dispute.id }, data: { status: 'READY_FOR_REVIEW', version: { increment: 1 } } });
    await this.events.append(transaction, {
      matchId, disputeId: dispute.id, resultVersionId: dispute.triggerResultVersionId,
      type: 'EVIDENCE_DEADLINE_EXPIRED', eventKey: `dispute:${dispute.id}:evidence-expired`,
      actorType: 'SYSTEM', occurredAt: dispute.evidenceDeadlineAt, metadata: { missingRoles }
    });
  }

  private async correctForParticipant(userId: string, matchId: string, at?: Date) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockMatch(transaction, matchId);
      await this.participantMatch(transaction, userId, matchId);
      await this.advanceMatch(transaction, matchId, at ?? new Date());
    });
  }

  private async createDispute(transaction: CompetitionTransaction, proposal: MatchResultVersion, userId: string,
    trigger: 'REJECTED' | 'CONFIRMATION_TIMEOUT', now: Date) {
    const dispute = await transaction.matchResultDispute.create({ data: {
      matchId: proposal.matchId, activeKey: proposal.matchId, triggerResultVersionId: proposal.id,
      trigger, openedByUserId: userId, evidenceDeadlineAt: new Date(now.getTime() + EVIDENCE_WINDOW_MS)
    } });
    // Keep the triggering proposal's image; superseded submissions must not consume active role slots.
    const stale = await transaction.matchResultEvidence.findMany({ where: {
      matchId: proposal.matchId, status: 'ACTIVE', role: { in: ['SUBMITTER', 'OPPONENT'] },
      OR: [{ resultVersionId: { not: proposal.id } }, { resultVersionId: null }]
    }, select: { id: true } });
    if (stale.length) {
      await transaction.matchResultEvidence.updateMany({ where: { id: { in: stale.map(({ id }) => id) } }, data: { status: 'PENDING_DELETE', expiresAt: now } });
      await this.events.append(transaction, {
        matchId: proposal.matchId, disputeId: dispute.id, resultVersionId: proposal.id,
        type: 'EVIDENCE_REPLACED', eventKey: `dispute:${dispute.id}:superseded-evidence`,
        actorType: 'USER', actorUserId: userId, occurredAt: now,
        metadata: { replacedEvidenceIds: stale.map(({ id }) => id) }
      });
    }
    // Initial result evidence remains valid for the submitter when rejection opens a dispute.
    await transaction.matchResultEvidence.updateMany({ where: {
      resultVersionId: proposal.id, role: 'SUBMITTER', status: 'ACTIVE', disputeId: null
    }, data: { disputeId: dispute.id } });
    await this.events.append(transaction, {
      matchId: proposal.matchId, disputeId: dispute.id, resultVersionId: proposal.id,
      type: 'DISPUTE_OPENED', eventKey: `dispute:${dispute.id}:opened`, actorType: 'USER', actorUserId: userId,
      occurredAt: now, metadata: { trigger }
    });
    return dispute;
  }

  private async consumeEvidence(transaction: CompetitionTransaction, dispute: MatchResultDispute, userId: string,
    role: 'SUBMITTER' | 'OPPONENT', uploadId: string, now: Date) {
    const claimed = await transaction.matchResultEvidenceUpload.updateMany({ where: {
      id: uploadId, matchId: dispute.matchId, uploadedByUserId: userId, role, status: 'UPLOADED',
      completedAt: { not: null }, resultVersionId: null, disputeId: null
    }, data: { status: 'CONSUMED', disputeId: dispute.id, consumedAt: now } });
    if (claimed.count !== 1) throw new CompetitionError('EVIDENCE_UPLOAD_INVALID', 'Completed evidence upload is unavailable for this participant role', 409);
    const upload = await transaction.matchResultEvidenceUpload.findUniqueOrThrow({ where: { id: uploadId } });
    const old = await transaction.matchResultEvidence.findMany({ where: { disputeId: dispute.id, role, status: 'ACTIVE' }, select: { id: true } });
    await transaction.matchResultEvidence.updateMany({ where: { id: { in: old.map(({ id }) => id) } }, data: { status: 'PENDING_DELETE', expiresAt: now } });
    const evidence = await transaction.matchResultEvidence.create({ data: {
      matchId: dispute.matchId, disputeId: dispute.id, resultVersionId: dispute.triggerResultVersionId,
      uploadId, role, uploadedByUserId: userId, objectKey: upload.objectKey, mimeType: upload.mimeType,
      byteSize: upload.byteSize, checksumSha256: upload.checksumSha256
    } });
    await this.events.append(transaction, {
      matchId: dispute.matchId, disputeId: dispute.id, resultVersionId: dispute.triggerResultVersionId,
      type: old.length ? 'EVIDENCE_REPLACED' : 'EVIDENCE_UPLOADED', eventKey: `evidence:${evidence.id}:attached`,
      actorType: 'USER', actorUserId: userId, occurredAt: now,
      metadata: { role, evidenceId: evidence.id, replacedEvidenceIds: old.map(({ id }) => id) }
    });
  }

  private async participantResponse(transaction: CompetitionTransaction, dispute: MatchResultDispute, matchVersion: number): Promise<ParticipantMatchResultDisputeResponse> {
    const evidence = await transaction.matchResultEvidence.findMany({ where: { disputeId: dispute.id, status: 'ACTIVE' }, select: { role: true } });
    return {
      id: dispute.id, matchId: dispute.matchId, trigger: dispute.trigger, status: dispute.status,
      evidenceDeadlineAt: dispute.evidenceDeadlineAt.toISOString(), matchVersion,
      evidencePresence: { SUBMITTER: evidence.some(({ role }) => role === 'SUBMITTER'), OPPONENT: evidence.some(({ role }) => role === 'OPPONENT') }
    };
  }

  private async participantMatch(transaction: CompetitionTransaction, userId: string, matchId: string) {
    const match = await transaction.competitionMatch.findUnique({ where: { id: matchId }, include: participantInclude });
    if (!match || match.stage.competition.season?.league.isDeleted) throw new CompetitionError('MATCH_NOT_FOUND', 'Match was not found', 404);
    const participants = [match.homeParticipant, match.awayParticipant];
    if (!participants.some((participant) => participant.individualUserId === userId || participant.seasonEntry?.ownerUserId === userId)) {
      throw new CompetitionError('MATCH_NOT_FOUND', 'Match was not found', 404);
    }
    if (match.stage.status !== 'PUBLISHED' || ['DRAFT', 'CANCELLED'].includes(match.stage.competition.status)) {
      throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Dispute is unavailable for this match', 409);
    }
    if (participants.some((participant) => participant.seasonEntry && participant.seasonEntry.leagueTeam.status !== 'ACTIVE')) {
      throw new CompetitionError('TEAM_ARCHIVED', 'League team has withdrawn', 409);
    }
    return match;
  }

  private lockMatch(transaction: CompetitionTransaction, matchId: string): Promise<unknown> {
    return transaction.$queryRaw`SELECT id FROM competition_matches WHERE id = ${matchId} FOR UPDATE`;
  }
}
