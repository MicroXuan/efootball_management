import { Inject, Injectable } from '@nestjs/common';
import { AdminResolveMatchResultDisputeRequestSchema, AdminMatchResultDisputeResponseSchema, type AdminResolveMatchResultDisputeRequest } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { ResultsService } from './results.service.js';
import { MatchResultDisputesService } from './match-result-disputes.service.js';
import { ResultEvidenceStorageService } from './result-evidence-storage.service.js';
import { CompetitionError } from './competition.errors.js';
import type { CompetitionTransaction } from './competition.types.js';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class AdminMatchResultDisputesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(ResultsService) private readonly results: ResultsService,
    @Inject(MatchResultDisputesService) private readonly disputes: MatchResultDisputesService,
    @Inject(ResultEvidenceStorageService) private readonly evidence: ResultEvidenceStorageService
  ) {}

  private scope(leagueId: string): Prisma.MatchResultDisputeWhereInput {
    const participant = { OR: [{ seasonEntryId: null }, { seasonEntry: { leagueTeam: { status: 'ACTIVE' as const } } }] };
    return { match: { stage: { status: 'PUBLISHED', competition: { status: { in: ['IN_PROGRESS', 'COMPLETED'] }, season: { leagueId, league: { isDeleted: false } } } },
      homeParticipant: participant, awayParticipant: participant } };
  }

  private readonly identityInclude = {
    match: { include: {
      stage: { select: { displayName: true, stageCode: true, competition: { select: { name: true } } } },
      homeParticipant: { select: { displayNameSnapshot: true, individualUserId: true, seasonEntry: { select: { ownerUserId: true } } } },
      awayParticipant: { select: { displayNameSnapshot: true, individualUserId: true, seasonEntry: { select: { ownerUserId: true } } } }
    } },
    triggerResultVersion: { select: { submissionSide: true, homeScore: true, awayScore: true } }
  } satisfies Prisma.MatchResultDisputeInclude;

  private identity(row: {
    match: { version: number; stage: { displayName: string | null; stageCode: string | null; competition: { name: string } };
      homeParticipant: { displayNameSnapshot: string }; awayParticipant: { displayNameSnapshot: string } };
    triggerResultVersion: { submissionSide: string; homeScore: number; awayScore: number };
  }) {
    if (row.triggerResultVersion.submissionSide !== 'HOME' && row.triggerResultVersion.submissionSide !== 'AWAY') {
      throw new CompetitionError('DISPUTE_CONTEXT_INVALID', 'Dispute submitter side is unavailable', 500);
    }
    return {
      matchVersion: row.match.version,
      competitionName: row.match.stage.competition.name,
      stageName: row.match.stage.displayName ?? row.match.stage.stageCode ?? '未命名阶段',
      homeParticipantName: row.match.homeParticipant.displayNameSnapshot,
      awayParticipantName: row.match.awayParticipant.displayNameSnapshot,
      submitterSide: row.triggerResultVersion.submissionSide,
      triggerHomeScore: row.triggerResultVersion.homeScore,
      triggerAwayScore: row.triggerResultVersion.awayScore
    };
  }

  async list(adminId: string, leagueId: string) {
    await this.authorization.requireLeagueAccess(adminId, leagueId);
    const rows = await this.prisma.matchResultDispute.findMany({ where: this.scope(leagueId), include: this.identityInclude, orderBy: [{ evidenceDeadlineAt: 'asc' }, { id: 'asc' }] });
    const activeEvidence = rows.length ? await this.prisma.matchResultEvidence.findMany({
      where: { disputeId: { in: rows.map((row) => row.id) }, status: 'ACTIVE' },
      select: { disputeId: true, role: true }
    }) : [];
    const rolesByDispute = new Map<string, Set<string>>();
    for (const item of activeEvidence) {
      if (!item.disputeId) continue;
      const roles = rolesByDispute.get(item.disputeId) ?? new Set<string>();
      roles.add(item.role);
      rolesByDispute.set(item.disputeId, roles);
    }
    const now = new Date();
    const priority = (row: typeof rows[number]) => row.status === 'READY_FOR_REVIEW'
      || (row.status === 'EVIDENCE_COLLECTION' && row.evidenceDeadlineAt <= now) ? 0 : row.status === 'EVIDENCE_COLLECTION' ? 1 : 2;
    return rows.sort((a, b) => priority(a) - priority(b)).map((row) => {
      const present = rolesByDispute.get(row.id);
      const missingRoles = (['SUBMITTER', 'OPPONENT'] as const).filter((role) => !present?.has(role));
      return AdminMatchResultDisputeResponseSchema.parse(JSON.parse(JSON.stringify({ ...row, ...this.identity(row), missingRoles })));
    });
  }

  async detail(adminId: string, leagueId: string, disputeId: string) {
    await this.authorization.requireLeagueAccess(adminId, leagueId);
    const dispute = await this.requireDispute(this.prisma, leagueId, disputeId);
    const [evidence, timeline] = await Promise.all([
      this.prisma.matchResultEvidence.findMany({ where: { matchId: dispute.matchId },
        include: { resultVersion: { select: { submissionSide: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.matchResultEvent.findMany({ where: { matchId: dispute.matchId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] })
    ]);
    // The response schema deliberately excludes object keys and internal upload identifiers.
    const side = (userId: string | null) => {
      if (!userId) return null;
      const home = dispute.match.homeParticipant;
      const away = dispute.match.awayParticipant;
      if (home.individualUserId === userId || home.seasonEntry?.ownerUserId === userId) return 'HOME';
      if (away.individualUserId === userId || away.seasonEntry?.ownerUserId === userId) return 'AWAY';
      return null;
    };
    const attributed = evidence.map((item) => {
      const proposalSide = item.resultVersion?.submissionSide;
      const evidenceSide = proposalSide === 'HOME' || proposalSide === 'AWAY'
        ? item.role === 'OPPONENT' ? (proposalSide === 'HOME' ? 'AWAY' : 'HOME') : proposalSide
        : null;
      return { ...item, uploaderSide: item.uploadedByAdminId ? 'ADMIN' : evidenceSide ?? side(item.uploadedByUserId) };
    });
    return AdminMatchResultDisputeResponseSchema.parse(JSON.parse(JSON.stringify({ ...dispute, ...this.identity(dispute), evidence: attributed, timeline })));
  }

  async readUrl(adminId: string, leagueId: string, disputeId: string, evidenceId: string) {
    await this.authorization.requireLeagueAccess(adminId, leagueId);
    const dispute = await this.requireDispute(this.prisma, leagueId, disputeId);
    return this.evidence.adminReadUrl(adminId, leagueId, dispute.matchId, evidenceId);
  }

  async resolve(adminId: string, leagueId: string, disputeId: string, input: AdminResolveMatchResultDisputeRequest) {
    await this.authorization.requireLeagueAccess(adminId, leagueId);
    const parsed = AdminResolveMatchResultDisputeRequestSchema.parse(input);
    const initial = await this.requireDispute(this.prisma, leagueId, disputeId);
    return this.prisma.$transaction(async (transaction) => {
      await this.results.lockForOfficialResult(transaction, initial.matchId);
      const now = new Date();
      await this.disputes.advanceMatch(transaction, initial.matchId, now);
      const dispute = await this.requireDispute(transaction, leagueId, disputeId);
      if (dispute.status !== 'READY_FOR_REVIEW' || dispute.activeKey !== dispute.matchId) {
        throw new CompetitionError('DISPUTE_NOT_READY', 'Dispute is not ready for administrator review', 409);
      }
      const proposal = await transaction.matchResultVersion.findUniqueOrThrow({ where: { id: dispute.triggerResultVersionId } });
      const scores = parsed.decisionType === 'USE_SUBMITTED_SCORE' ? proposal : parsed;
      return this.results.applyAdministratorResult(transaction, dispute.matchId, {
        ...parsed, homeScore: scores.homeScore, awayScore: scores.awayScore
      }, { adminId, leagueId }, now, parsed.decisionType);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async requireDispute(client: CompetitionTransaction | PrismaService, leagueId: string, id: string) {
    const dispute = await client.matchResultDispute.findFirst({ where: { id, ...this.scope(leagueId) }, include: this.identityInclude });
    if (!dispute) throw new CompetitionError('DISPUTE_NOT_FOUND', 'Dispute was not found', 404);
    return dispute;
  }
}
