import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ManagerMatchResultRequest,
  MatchResultVersionResponse,
  RejectMatchResultRequest,
  SubmitMatchResultRequest,
  VersionedMutationRequest
} from '@efm/contracts';
import type { MatchResultSubmissionSide, MatchResultVersion, MatchResultDecisionType, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError, assertExpectedVersion } from './competition.errors.js';
import type { CompetitionTransaction } from './competition.types.js';
import { MutationReceiptService } from './mutation-receipt.service.js';
import { StandingsService } from './standings.service.js';
import { CupProgressionService } from './cup-progression.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { MatchResultEventsService } from './match-result-events.service.js';
import { MatchResultDisputesService } from './match-result-disputes.service.js';

const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const EVIDENCE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

type MatchRecord = Prisma.CompetitionMatchGetPayload<{
  include: {
    stage: { include: { competition: { include: { season: { include: { league: true } } } } } };
    homeParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } };
    awayParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } };
    officialResultVersion: true;
  };
}>;

@Injectable()
export class ResultsService {
  private readonly visibility: LeagueVisibilityService;
  private readonly events: MatchResultEventsService;
  private readonly disputes: MatchResultDisputesService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
    @Inject(StandingsService) private readonly standings: StandingsService,
    @Inject(CupProgressionService) private readonly cupProgression: CupProgressionService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService,
    @Optional() @Inject(AdminMutationReceiptService) private readonly adminReceipts?: AdminMutationReceiptService,
    @Optional() @Inject(AdminAuthorizationService) private readonly adminAuthorization?: AdminAuthorizationService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
    @Optional() @Inject(MatchResultEventsService) events?: MatchResultEventsService,
    @Optional() @Inject(MatchResultDisputesService) disputes?: MatchResultDisputesService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
    this.events = events ?? new MatchResultEventsService();
    this.disputes = disputes ?? new MatchResultDisputesService(prisma, receipts, this.events);
  }

  async submit(userId: string, matchId: string, input: SubmitMatchResultRequest, key: string) {
    await this.visibility.requireVisible({ type: 'MATCH', id: matchId });
    return this.receipts.execute(userId, `match.result.submit:${matchId}`, key, async (transaction) => {
      await this.lockMatch(transaction, matchId);
      const match = await this.playerMatch(transaction, userId, matchId);
      this.assertInProgress(match);
      assertExpectedVersion(match.version, input.expectedVersion, 'Match');
      if (match.status === 'DISPUTED') throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Match is under dispute review', 409);
      this.assertDecisiveKnockoutResult(match, input.homeScore, input.awayScore);
      if (match.stage.competition.season?.league.resultEvidenceRequired && !input.evidenceUploadId) {
        throw new CompetitionError('RESULT_EVIDENCE_REQUIRED', 'Result evidence is required by this league', 400);
      }
      const now = new Date();
      const submissionSide = this.side(match, userId);
      const created = await transaction.matchResultVersion.create({
        data: {
          matchId,
          version: await this.nextVersion(transaction, matchId),
          homeScore: input.homeScore,
          awayScore: input.awayScore,
          submittedById: userId,
          submissionSide
        }
      });
      const updated = await transaction.competitionMatch.updateMany({
        where: { id: matchId, version: input.expectedVersion },
        data: {
          status: 'PENDING_CONFIRMATION', version: { increment: 1 },
          resultConfirmationDeadlineAt: new Date(now.getTime() + CONFIRMATION_WINDOW_MS)
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      if (input.evidenceUploadId) {
        const claimed = await transaction.matchResultEvidenceUpload.updateMany({
          where: {
            id: input.evidenceUploadId, matchId, uploadedByUserId: userId,
            role: 'SUBMITTER', status: 'UPLOADED', resultVersionId: null, disputeId: null
          },
          data: { status: 'CONSUMED', resultVersionId: created.id, consumedAt: now }
        });
        if (claimed.count !== 1) {
          throw new CompetitionError('EVIDENCE_UPLOAD_INVALID', 'Submitter evidence upload is unavailable', 409);
        }
        const upload = await transaction.matchResultEvidenceUpload.findUniqueOrThrow({
          where: { id: input.evidenceUploadId }
        });
        await transaction.matchResultEvidence.create({
          data: {
            matchId, resultVersionId: created.id, uploadId: upload.id, role: 'SUBMITTER',
            uploadedByUserId: userId, objectKey: upload.objectKey, mimeType: upload.mimeType,
            byteSize: upload.byteSize, checksumSha256: upload.checksumSha256
          }
        });
      }
      await this.events.append(transaction, {
        matchId, resultVersionId: created.id, type: 'RESULT_SUBMITTED',
        eventKey: `result:${created.id}:submitted`, actorType: 'USER', actorUserId: userId,
        occurredAt: now, metadata: { homeScore: created.homeScore, awayScore: created.awayScore }
      });
      return this.response(created, userId);
    });
  }

  async confirm(userId: string, matchId: string, resultVersion: number, input: VersionedMutationRequest, key: string) {
    await this.visibility.requireVisible({ type: 'MATCH', id: matchId });
    return this.receipts.execute(userId, `match.result.confirm:${matchId}:${resultVersion}`, key, async (transaction) => {
      await this.lockForOfficialResult(transaction, matchId);
      const match = await this.playerMatch(transaction, userId, matchId);
      this.assertInProgress(match);
      assertExpectedVersion(match.version, input.expectedVersion, 'Match');
      if (match.status !== 'PENDING_CONFIRMATION') throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Match is not awaiting confirmation', 409);
      await this.disputes.advanceMatch(transaction, matchId, new Date());
      const proposal = await transaction.matchResultVersion.findUnique({
        where: { matchId_version: { matchId, version: resultVersion } }
      });
      if (!proposal || proposal.status !== 'PROPOSED') throw this.resultNotFound();
      this.assertDecisiveKnockoutResult(match, proposal.homeScore, proposal.awayScore);
      if (proposal.submittedById === userId) {
        throw new CompetitionError('RESULT_SELF_CONFIRMATION_FORBIDDEN', 'Submitter cannot confirm their own result', 409);
      }
      const now = new Date();
      const official = await transaction.matchResultVersion.update({
        where: { id: proposal.id }, data: { status: 'OFFICIAL' }
      });
      const updated = await transaction.competitionMatch.updateMany({
        where: { id: matchId, version: input.expectedVersion, officialResultVersionId: null },
        data: {
          officialResultVersionId: official.id, status: 'CONFIRMED', version: { increment: 1 },
          resultConfirmationDeadlineAt: null
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await transaction.matchResultEvidence.updateMany({
        where: { matchId, status: 'ACTIVE' },
        data: { expiresAt: new Date(now.getTime() + EVIDENCE_RETENTION_MS) }
      });
      await this.events.append(transaction, {
        matchId, resultVersionId: official.id, type: 'RESULT_CONFIRMED',
        eventKey: `result:${official.id}:confirmed`, actorType: 'USER', actorUserId: userId,
        occurredAt: now
      });
      await this.afterOfficialResult(transaction, match, official.id, official.homeScore, official.awayScore);
      return this.response(official, userId);
    });
  }

  async reject(userId: string, matchId: string, resultVersion: number, input: RejectMatchResultRequest, key: string) {
    await this.visibility.requireVisible({ type: 'MATCH', id: matchId });
    return this.receipts.execute(userId, `match.result.reject:${matchId}:${resultVersion}`, key, async (transaction) => {
      if (!input.reason?.trim()) {
        throw new CompetitionError('RESULT_REJECTION_REASON_REQUIRED', 'Rejection reason is required', 400);
      }
      await this.lockMatch(transaction, matchId);
      const match = await this.playerMatch(transaction, userId, matchId);
      this.assertInProgress(match);
      assertExpectedVersion(match.version, input.expectedVersion, 'Match');
      if (match.status !== 'PENDING_CONFIRMATION') throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Match is not awaiting confirmation', 409);
      await this.disputes.advanceMatch(transaction, matchId, new Date());
      const proposal = await transaction.matchResultVersion.findUnique({
        where: { matchId_version: { matchId, version: resultVersion } }
      });
      if (!proposal || proposal.status !== 'PROPOSED') throw this.resultNotFound();
      if (proposal.submittedById === userId) {
        throw new CompetitionError('RESULT_SELF_REJECTION_FORBIDDEN', 'Submitter cannot reject their own result', 409);
      }
      const now = new Date();
      const rejected = await transaction.matchResultVersion.update({
        where: { id: proposal.id }, data: { status: 'REJECTED', reason: input.reason.trim() }
      });
      const updated = await transaction.competitionMatch.updateMany({
        where: { id: matchId, version: input.expectedVersion },
        data: { status: 'DISPUTED', version: { increment: 1 }, resultConfirmationDeadlineAt: null }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await this.events.append(transaction, {
        matchId, resultVersionId: rejected.id, type: 'RESULT_REJECTED',
        eventKey: `result:${rejected.id}:rejected`, actorType: 'USER', actorUserId: userId,
        occurredAt: now, metadata: { reason: input.reason.trim() }
      });
      await this.disputes.openFromRejection(transaction, rejected, userId, now);
      return this.response(rejected, userId);
    });
  }

  async recordByManager(
    actorId: string,
    competitionId: string,
    matchId: string,
    input: ManagerMatchResultRequest,
    key: string
  ) {
    const matchLeagueId = await this.visibility.requireVisible({ type: 'MATCH', id: matchId });
    const competitionLeagueId = await this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId });
    if (matchLeagueId !== competitionLeagueId) throw this.visibility.notFound();
    return this.receipts.execute(actorId, `match.result.manager:${matchId}`, key, async (transaction) => {
      await this.lockForOfficialResult(transaction, matchId);
      const match = await this.managerMatch(transaction, competitionId, matchId);
      const official = await this.applyAdministratorResult(transaction, match.id, input, { userId: actorId }, new Date());
      return this.response(official, actorId);
    });
  }

  async recordByLeagueAdmin(
    actorAdminId: string,
    leagueId: string,
    competitionId: string,
    matchId: string,
    input: ManagerMatchResultRequest,
    key: string
  ): Promise<MatchResultVersionResponse> {
    if (!this.adminReceipts || !this.adminAuthorization || !this.audit) {
      throw new Error('League administrator result dependencies are not configured');
    }
    const [matchLeagueId, competitionLeagueId] = await Promise.all([
      this.visibility.requireVisible({ type: 'MATCH', id: matchId }),
      this.visibility.requireVisible({ type: 'COMPETITION', id: competitionId })
    ]);
    if (matchLeagueId !== leagueId || competitionLeagueId !== leagueId) {
      throw this.visibility.notFound();
    }
    await this.adminAuthorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.adminReceipts.execute(
      actorAdminId,
      `admin.competition-result.record:${matchId}`,
      key,
      async (transaction) => {
        await this.lockForOfficialResult(transaction, matchId);
        const match = await this.managerMatch(transaction, competitionId, matchId);
        const official = await this.applyAdministratorResult(transaction, match.id, input, { adminId: actorAdminId, leagueId }, new Date());
        return { ...this.response(official, ''), submittedByMe: true };
      },
      input
    );
  }

  // All official writers share this ordering, including ordinary participant confirmation.
  // User submissions/rejections take only their match lock and never request progression locks.
  async lockForOfficialResult(transaction: CompetitionTransaction, matchId: string): Promise<void> {
    await this.cupProgression.lockCompetition(transaction, matchId);
    await this.lockMatch(transaction, matchId);
  }

  // Internal boundary: callers authorize, use ReadCommitted, and hold competition + match locks.
  // Both receipt services used by direct admin/user-manager entry already use ReadCommitted.
  async applyAdministratorResult(transaction: CompetitionTransaction, matchId: string, input: ManagerMatchResultRequest,
    actor: { adminId: string; leagueId: string } | { userId: string }, now: Date,
    decisionType: MatchResultDecisionType = 'REPLACE_SCORE') {
    const match = await this.match(transaction, matchId);
    const adminId = 'adminId' in actor ? actor.adminId : undefined;
    const userId = 'userId' in actor ? actor.userId : undefined;
    const leagueId = match.stage.competition.season?.league.id;
    if ('leagueId' in actor && actor.leagueId !== leagueId) throw this.visibility.notFound();
    if (match.stage.competition.season?.league.isDeleted || match.stage.status !== 'PUBLISHED'
      || !['IN_PROGRESS', 'COMPLETED'].includes(match.stage.competition.status)) {
      throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Administrator result is unavailable', 409);
    }
    assertExpectedVersion(match.version, input.expectedVersion, 'Match');
    const reason = input.reason?.trim();
    if (!reason) throw new CompetitionError('RESULT_CORRECTION_REASON_REQUIRED', 'Administrator decision reason is required', 400);
    if (![input.homeScore, input.awayScore].every((score) => Number.isInteger(score) && score >= 0 && score <= 99)) {
      throw new CompetitionError('INVALID_RESULT_SCORE', 'Scores must be integers between 0 and 99', 400);
    }
    this.assertDecisiveKnockoutResult(match, input.homeScore, input.awayScore);
    const dispute = await transaction.matchResultDispute.findUnique({ where: { activeKey: matchId } });
    const official = await transaction.matchResultVersion.create({ data: {
      matchId, version: await this.nextVersion(transaction, matchId), homeScore: input.homeScore, awayScore: input.awayScore,
      submittedById: userId ?? null, submittedByAdminId: adminId ?? null, submissionSide: 'MANAGER', status: 'OFFICIAL', reason
    } });
    if (match.officialResultVersion) await transaction.matchResultVersion.update({ where: { id: match.officialResultVersion.id }, data: { status: 'SUPERSEDED' } });
    if (input.evidenceUploadId) {
      if (!adminId) throw new CompetitionError('EVIDENCE_UPLOAD_INVALID', 'Administrator evidence requires an administrator account', 409);
      const claimed = await transaction.matchResultEvidenceUpload.updateMany({ where: {
        id: input.evidenceUploadId, matchId, uploadedByAdminId: adminId, uploadedByUserId: null, role: 'ADMIN',
        status: 'UPLOADED', completedAt: { not: null }, resultVersionId: null, disputeId: null
      }, data: { status: 'CONSUMED', resultVersionId: official.id, disputeId: dispute?.id ?? null, consumedAt: now } });
      if (claimed.count !== 1) throw new CompetitionError('EVIDENCE_UPLOAD_INVALID', 'Completed administrator evidence is unavailable', 409);
      const upload = await transaction.matchResultEvidenceUpload.findUniqueOrThrow({ where: { id: input.evidenceUploadId } });
      const replaced = await transaction.matchResultEvidence.findMany({ where: { matchId, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
      await transaction.matchResultEvidence.updateMany({ where: { matchId, role: 'ADMIN', status: 'ACTIVE' }, data: { status: 'PENDING_DELETE', expiresAt: now } });
      const evidence = await transaction.matchResultEvidence.create({ data: {
        matchId, resultVersionId: official.id, disputeId: dispute?.id ?? null, uploadId: upload.id, role: 'ADMIN', uploadedByAdminId: adminId,
        objectKey: upload.objectKey, mimeType: upload.mimeType, byteSize: upload.byteSize, checksumSha256: upload.checksumSha256
      } });
      await this.events.append(transaction, { matchId, resultVersionId: official.id, disputeId: dispute?.id ?? null,
        type: replaced.length ? 'EVIDENCE_REPLACED' : 'EVIDENCE_UPLOADED', eventKey: `evidence:${evidence.id}:attached`, actorType: 'ADMIN', actorAdminId: adminId,
        occurredAt: now, metadata: { evidenceId: evidence.id, role: 'ADMIN', replacedEvidenceIds: replaced.map(({ id }) => id) } });
    }
    await transaction.competitionMatch.update({ where: { id: matchId }, data: {
      officialResultVersionId: official.id, status: 'ADMIN_DECIDED', version: { increment: 1 }, resultConfirmationDeadlineAt: null
    } });
    if (dispute) await transaction.matchResultDispute.update({ where: { id: dispute.id }, data: {
      status: 'RESOLVED', activeKey: null, decisionType, decisionReason: reason, decidedByAdminId: adminId ?? null,
      finalHomeScore: input.homeScore, finalAwayScore: input.awayScore, decidedAt: now, version: { increment: 1 }
    } });
    await transaction.matchResultEvidence.updateMany({ where: { matchId, status: 'ACTIVE' }, data: { expiresAt: new Date(now.getTime() + EVIDENCE_RETENTION_MS) } });
    await this.events.append(transaction, { matchId, disputeId: dispute?.id ?? null, resultVersionId: official.id, type: 'ADMIN_DECIDED',
      eventKey: `result:${official.id}:admin-decided`, actorType: adminId ? 'ADMIN' : 'USER', actorAdminId: adminId ?? null, actorUserId: userId ?? null,
      occurredAt: now, metadata: { reason, decisionType, homeScore: input.homeScore, awayScore: input.awayScore } });
    await (this.audit ?? new AuditLogService(this.prisma)).record(transaction, {
      ...(adminId ? { actorAdminId: adminId } : { actorUserId: userId! }), leagueId: leagueId ?? null, action: 'admin.competition-result.record', resourceType: 'CompetitionMatch', resourceId: matchId,
      reason, metadata: { competitionId: match.stage.competitionId, stageId: match.stageId, homeScore: input.homeScore, awayScore: input.awayScore,
        corrected: Boolean(match.officialResultVersion), previousResultVersionId: match.officialResultVersion?.id ?? null, disputeId: dispute?.id ?? null }
    });
    await this.afterOfficialResult(transaction, match, official.id, official.homeScore, official.awayScore, true);
    return official;
  }

  private async playerMatch(transaction: CompetitionTransaction, userId: string, matchId: string): Promise<MatchRecord> {
    const match = await this.match(transaction, matchId);
    if (!this.owns(match.homeParticipant, userId) && !this.owns(match.awayParticipant, userId)) {
      throw new CompetitionError('MATCH_NOT_FOUND', 'Match was not found', 404);
    }
    return match;
  }

  private async managerMatch(transaction: CompetitionTransaction, competitionId: string, matchId: string): Promise<MatchRecord> {
    const match = await this.match(transaction, matchId);
    if (match.stage.competitionId !== competitionId) {
      throw new CompetitionError('MATCH_NOT_FOUND', 'Match was not found', 404);
    }
    return match;
  }

  private async match(transaction: CompetitionTransaction, matchId: string): Promise<MatchRecord> {
    const match = await transaction.competitionMatch.findUnique({
      where: { id: matchId },
      include: {
        stage: { include: { competition: { include: { season: { include: { league: true } } } } } },
        homeParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } },
        awayParticipant: { include: { seasonEntry: { include: { leagueTeam: true } } } },
        officialResultVersion: true
      }
    });
    if (!match) throw new CompetitionError('MATCH_NOT_FOUND', 'Match was not found', 404);
    const archived = [match.homeParticipant, match.awayParticipant]
      .some((participant) => participant.seasonEntry?.leagueTeam?.status === 'ARCHIVED');
    if (archived) throw new CompetitionError('TEAM_ARCHIVED', 'League team has withdrawn', 409);
    return match;
  }

  private assertInProgress(match: MatchRecord): void {
    if (match.stage.status !== 'PUBLISHED' || match.stage.competition.status !== 'IN_PROGRESS') {
      throw new CompetitionError('MATCH_RESULT_NOT_ALLOWED', 'Results are accepted only during competition play', 409);
    }
  }

  private assertDecisiveKnockoutResult(match: MatchRecord, homeScore: number, awayScore: number): void {
    if (match.stage.format === 'SINGLE_ELIMINATION' && homeScore === awayScore) {
      throw new CompetitionError('KNOCKOUT_DRAW_NOT_ALLOWED', '淘汰赛比分不能为平局', 409);
    }
  }

  private async afterOfficialResult(
    transaction: CompetitionTransaction,
    match: MatchRecord,
    resultVersionId: string,
    homeScore: number,
    awayScore: number,
    allowCorrection = false
  ): Promise<void> {
    if (match.stage.format === 'SINGLE_ELIMINATION') {
      if (allowCorrection) await this.cupProgression.recordWinner(transaction, match.id, homeScore, awayScore, true);
      else await this.cupProgression.recordWinner(transaction, match.id, homeScore, awayScore);
      return;
    }
    const scopedToStage = ['DIVISION_LEAGUE', 'GROUP_KNOCKOUT_CUP'].includes(
      match.stage.competition.competitionType
    );
    await this.standings.recalculate(
      transaction,
      match.stage.competitionId,
      resultVersionId,
      scopedToStage ? match.stageId : undefined
    );
  }

  private side(match: MatchRecord, userId: string): MatchResultSubmissionSide {
    return this.owns(match.homeParticipant, userId) ? 'HOME' : 'AWAY';
  }

  private owns(
    participant: MatchRecord['homeParticipant'] | MatchRecord['awayParticipant'],
    userId: string
  ): boolean {
    return participant.individualUserId === userId || participant.seasonEntry?.ownerUserId === userId;
  }

  private async nextVersion(transaction: CompetitionTransaction, matchId: string): Promise<number> {
    const latest = await transaction.matchResultVersion.aggregate({ where: { matchId }, _max: { version: true } });
    return (latest._max.version ?? 0) + 1;
  }

  private response(result: MatchResultVersion, userId: string): MatchResultVersionResponse {
    return {
      id: result.id,
      matchId: result.matchId,
      version: result.version,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      status: result.status,
      submissionSide: result.submissionSide,
      submittedByMe: result.submittedById === userId,
      reason: result.reason,
      createdAt: result.createdAt.toISOString()
    };
  }

  private lockMatch(transaction: CompetitionTransaction, matchId: string): Promise<unknown> {
    return transaction.$queryRaw`SELECT id FROM competition_matches WHERE id = ${matchId} FOR UPDATE`;
  }

  private resultNotFound() {
    return new CompetitionError('RESULT_VERSION_NOT_FOUND', 'Result version was not found', 404);
  }

  private versionConflict() {
    return new CompetitionError('VERSION_CONFLICT', 'Match has changed', 409);
  }
}
