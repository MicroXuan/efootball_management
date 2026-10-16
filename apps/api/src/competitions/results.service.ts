import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ManagerMatchResultRequest,
  MatchResultVersionResponse,
  RejectMatchResultRequest,
  SubmitMatchResultRequest,
  VersionedMutationRequest
} from '@efm/contracts';
import type { MatchResultSubmissionSide, MatchResultVersion, Prisma } from '../generated/prisma/client.js';
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

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
    @Inject(StandingsService) private readonly standings: StandingsService,
    @Inject(CupProgressionService) private readonly cupProgression: CupProgressionService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService,
    @Optional() @Inject(AdminMutationReceiptService) private readonly adminReceipts?: AdminMutationReceiptService,
    @Optional() @Inject(AdminAuthorizationService) private readonly adminAuthorization?: AdminAuthorizationService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService,
    @Optional() @Inject(MatchResultEventsService) events?: MatchResultEventsService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
    this.events = events ?? new MatchResultEventsService();
  }

  async submit(userId: string, matchId: string, input: SubmitMatchResultRequest, key: string) {
    await this.visibility.requireVisible({ type: 'MATCH', id: matchId });
    return this.receipts.execute(userId, `match.result.submit:${matchId}`, key, async (transaction) => {
      await this.lockMatch(transaction, matchId);
      const match = await this.playerMatch(transaction, userId, matchId);
      this.assertInProgress(match);
      assertExpectedVersion(match.version, input.expectedVersion, 'Match');
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
      await this.lockMatch(transaction, matchId);
      const match = await this.playerMatch(transaction, userId, matchId);
      this.assertInProgress(match);
      assertExpectedVersion(match.version, input.expectedVersion, 'Match');
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
        data: { status: 'AWAITING_RESULT', version: { increment: 1 }, resultConfirmationDeadlineAt: null }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await this.events.append(transaction, {
        matchId, resultVersionId: rejected.id, type: 'RESULT_REJECTED',
        eventKey: `result:${rejected.id}:rejected`, actorType: 'USER', actorUserId: userId,
        occurredAt: now, metadata: { reason: input.reason.trim() }
      });
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
      await this.lockMatch(transaction, matchId);
      const match = await this.managerMatch(transaction, competitionId, matchId);
      this.assertInProgress(match);
      assertExpectedVersion(match.version, input.expectedVersion, 'Match');
      this.assertDecisiveKnockoutResult(match, input.homeScore, input.awayScore);
      if (match.officialResultVersion && !input.reason?.trim()) {
        throw new CompetitionError('RESULT_CORRECTION_REASON_REQUIRED', 'Correction reason is required', 400);
      }
      const official = await transaction.matchResultVersion.create({
        data: {
          matchId,
          version: await this.nextVersion(transaction, matchId),
          homeScore: input.homeScore,
          awayScore: input.awayScore,
          submittedById: actorId,
          submissionSide: 'MANAGER',
          status: 'OFFICIAL',
          reason: input.reason?.trim() || null
        }
      });
      if (match.officialResultVersion) {
        await transaction.matchResultVersion.update({
          where: { id: match.officialResultVersion.id }, data: { status: 'SUPERSEDED' }
        });
      }
      const updated = await transaction.competitionMatch.updateMany({
        where: { id: matchId, version: input.expectedVersion },
        data: { officialResultVersionId: official.id, status: 'ADMIN_DECIDED', version: { increment: 1 } }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await this.afterOfficialResult(transaction, match, official.id, official.homeScore, official.awayScore);
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
        await this.lockMatch(transaction, matchId);
        const match = await this.managerMatch(transaction, competitionId, matchId);
        this.assertInProgress(match);
        assertExpectedVersion(match.version, input.expectedVersion, 'Match');
        this.assertDecisiveKnockoutResult(match, input.homeScore, input.awayScore);
        if (match.officialResultVersion && !input.reason?.trim()) {
          throw new CompetitionError('RESULT_CORRECTION_REASON_REQUIRED', '修改已有官方比分时必须填写修正原因', 400);
        }
        const official = await transaction.matchResultVersion.create({
          data: {
            matchId,
            version: await this.nextVersion(transaction, matchId),
            homeScore: input.homeScore,
            awayScore: input.awayScore,
            submittedById: null,
            submittedByAdminId: actorAdminId,
            submissionSide: 'MANAGER',
            status: 'OFFICIAL',
            reason: input.reason?.trim() || null
          }
        });
        if (match.officialResultVersion) {
          await transaction.matchResultVersion.update({
            where: { id: match.officialResultVersion.id }, data: { status: 'SUPERSEDED' }
          });
        }
        const updated = await transaction.competitionMatch.updateMany({
          where: { id: matchId, version: input.expectedVersion },
          data: { officialResultVersionId: official.id, status: 'ADMIN_DECIDED', version: { increment: 1 } }
        });
        if (updated.count !== 1) throw this.versionConflict();
        await this.afterOfficialResult(transaction, match, official.id, official.homeScore, official.awayScore);
        await this.audit!.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.competition-result.record',
          resourceType: 'CompetitionMatch',
          resourceId: matchId,
          reason: input.reason?.trim() || null,
          metadata: {
            competitionId,
            stageId: match.stageId,
            homeScore: input.homeScore,
            awayScore: input.awayScore,
            corrected: Boolean(match.officialResultVersion),
            previousResultVersionId: match.officialResultVersion?.id ?? null
          }
        });
        return { ...this.response(official, ''), submittedByMe: true };
      },
      input
    );
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
    awayScore: number
  ): Promise<void> {
    if (match.stage.format === 'SINGLE_ELIMINATION') {
      await this.cupProgression.recordWinner(transaction, match.id, homeScore, awayScore);
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
