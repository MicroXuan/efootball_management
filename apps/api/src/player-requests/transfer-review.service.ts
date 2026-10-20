import { Inject, Injectable } from '@nestjs/common';
import { ReviewTransferProposalSchema, type ReviewTransferProposal } from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeagueError } from '../leagues/league.errors.js';
import { RosterTransactionsService } from '../league-rosters/roster-transactions.service.js';

const include = { ownership: { include: { footballPlayer: true } }, sourceTeam: true, targetTeam: true,
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } satisfies Prisma.TransferProposalInclude;
type ProposalWithRelations = Prisma.TransferProposalGetPayload<{ include: typeof include }>;

@Injectable()
export class TransferReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(RosterTransactionsService) private readonly roster: RosterTransactionsService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async list(adminId: string, leagueId: string) {
    await this.authorization.requireLeagueManager(adminId, leagueId);
    const items = await this.prisma.transferProposal.findMany({ where: { leagueId }, include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return { items: items.map((item) => this.present(item)) };
  }

  async review(adminId: string, leagueId: string, id: string, raw: ReviewTransferProposal, key: string, at = new Date()) {
    const input = ReviewTransferProposalSchema.parse(raw);
    await this.authorization.requireLeagueManager(adminId, leagueId);
    return this.receipts.execute(adminId, `TRANSFER_PROPOSAL_REVIEW:${id}`, key, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM transfer_proposals WHERE id = ${id} FOR UPDATE`);
      const proposal = await tx.transferProposal.findUnique({ where: { id }, include });
      if (!proposal || proposal.leagueId !== leagueId) throw new LeagueError('TRANSFER_PROPOSAL_NOT_FOUND', '转会申请不存在', 404);
      if (proposal.status !== 'PENDING_ADMIN' || proposal.version !== input.expectedVersion) {
        throw new LeagueError('TRANSFER_REVIEW_CONFLICT', '申请状态已变化，请刷新', 409);
      }
      if (!proposal.counterpartyUserId) throw new LeagueError('TRANSFER_COUNTERPARTY_REQUIRED', '还没有对方球队确认', 409);
      if (input.decision === 'APPROVE') {
        if (proposal.ownership.status !== 'ACTIVE' || proposal.ownership.version !== proposal.expectedOwnershipVersion || proposal.ownership.leagueTeamId !== proposal.sourceTeamId) {
          throw new LeagueError('TRANSFER_OWNERSHIP_CHANGED', '球员归属已变化', 409);
        }
        await this.roster.transferWithClient(tx, {
          seasonId: proposal.seasonId, ownershipId: proposal.ownershipId,
          targetLeagueTeamId: proposal.targetTeamId, amountMinor: proposal.amountMinor,
          expectedVersion: proposal.expectedOwnershipVersion, reason: input.reason,
          idempotencyKey: key
        }, adminId, at);
      }
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const changed = await tx.transferProposal.updateMany({ where: { id, status: 'PENDING_ADMIN', version: input.expectedVersion },
        data: { status, reviewReason: input.reason, reviewedByAdminId: adminId, reviewedAt: at, version: { increment: 1 } } });
      if (changed.count !== 1) throw new LeagueError('TRANSFER_REVIEW_CONFLICT', '申请状态已变化，请刷新', 409);
      const event = await tx.transferProposalEvent.create({ data: { proposalId: id, fromStatus: 'PENDING_ADMIN', toStatus: status,
        actorAdminId: adminId, reason: input.reason, createdAt: at } });
      await this.audit.record(tx, { actorAdminId: adminId, leagueId, action: 'TRANSFER_PROPOSAL_REVIEWED',
        resourceType: 'TRANSFER_PROPOSAL', resourceId: id, reason: input.reason,
        metadata: { decision: input.decision, ownershipId: proposal.ownershipId, sourceTeamId: proposal.sourceTeamId,
          targetTeamId: proposal.targetTeamId, amountMinor: proposal.amountMinor } });
      return this.present({ ...proposal, status, version: proposal.version + 1, reviewReason: input.reason, reviewedAt: at,
        events: [...proposal.events, event] });
    }, input);
  }

  private present(proposal: ProposalWithRelations) {
    return { id: proposal.id, leagueId: proposal.leagueId, seasonId: proposal.seasonId, ownershipId: proposal.ownershipId,
      playerName: proposal.ownership.footballPlayer.nameZh ?? proposal.ownership.footballPlayer.nameEn ?? '未知球员',
      sourceTeamId: proposal.sourceTeamId, sourceTeamName: proposal.sourceTeam.name, sourceTeamNumber: proposal.sourceTeam.teamNumber,
      targetTeamId: proposal.targetTeamId, targetTeamName: proposal.targetTeam.name, targetTeamNumber: proposal.targetTeam.teamNumber,
      initiatorTeamId: proposal.initiatorTeamId, amountMinor: proposal.amountMinor, status: proposal.status,
      reason: proposal.reason, reviewReason: proposal.reviewReason, version: proposal.version,
      createdAt: proposal.createdAt.toISOString(), reviewedAt: proposal.reviewedAt?.toISOString() ?? null,
      counterpartyConfirmed: !!proposal.counterpartyUserId,
      events: proposal.events.map((event) => ({ id: event.id, fromStatus: event.fromStatus, toStatus: event.toStatus,
        reason: event.reason, createdAt: event.createdAt.toISOString() })) };
  }
}
