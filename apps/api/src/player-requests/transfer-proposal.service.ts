import { Inject, Injectable } from '@nestjs/common';
import { RespondTransferProposalSchema, SubmitTransferProposalSchema, type RespondTransferProposal, type SubmitTransferProposal } from '@efm/contracts';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeagueError } from '../leagues/league.errors.js';
import { TransferWindowsService } from '../league-rosters/transfer-windows.service.js';
import { PlayerMarketAccessService } from '../player-market/player-market-access.service.js';

const include = {
  ownership: { include: { footballPlayer: true } },
  sourceTeam: true,
  targetTeam: true,
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }
} satisfies Prisma.TransferProposalInclude;
type ProposalWithRelations = Prisma.TransferProposalGetPayload<{ include: typeof include }>;

@Injectable()
export class TransferProposalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerMarketAccessService) private readonly access: PlayerMarketAccessService,
    @Inject(TransferWindowsService) private readonly windows: TransferWindowsService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService
  ) {}

  async candidate(userId: string, leagueId: string, seasonId: string, playerId: string, at = new Date()) {
    await this.access.requireParticipant(userId, leagueId, seasonId);
    const ownership = await this.prisma.leaguePlayerOwnership.findUnique({
      where: { leagueId_footballPlayerId: { leagueId, footballPlayerId: playerId } },
      include: { leagueTeam: true }
    });
    if (!ownership) throw new LeagueError('TRANSFER_CANDIDATE_NOT_FOUND', '球员不在当前联赛阵容中', 404);
    let reason: string | null = null;
    if (ownership.status !== 'ACTIVE') reason = '球员当前不在一线阵容';
    else {
      try { await this.windows.requireAllowed(seasonId, 'TRANSFER', at); }
      catch { reason = '当前不在转会期'; }
    }
    return { ownershipId: ownership.id, ownershipVersion: ownership.version, sourceTeamId: ownership.leagueTeamId,
      sourceTeamNumber: ownership.leagueTeam.teamNumber, sourceTeamName: ownership.leagueTeam.name, eligible: reason === null, reason };
  }

  async listMine(userId: string, seasonId: string) {
    const season = await this.prisma.leagueSeason.findUnique({ where: { id: seasonId }, select: { leagueId: true } });
    if (!season) throw new LeagueError('SEASON_NOT_FOUND', '赛季不存在', 404);
    const scope = await this.access.requireParticipant(userId, season.leagueId, seasonId);
    const items = await this.prisma.transferProposal.findMany({
      where: { seasonId, OR: [{ sourceTeamId: scope.leagueTeamId }, { targetTeamId: scope.leagueTeamId }] },
      include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    return { items: items.map((item) => this.present(item)) };
  }

  async submit(userId: string, raw: SubmitTransferProposal, key: string, at = new Date()) {
    const input = SubmitTransferProposalSchema.parse(raw);
    const scope = await this.access.requireOwnedTeam(userId, input.initiatorTeamId, input.seasonId);
    return this.receipts.execute(userId, `transfer.propose:${input.ownershipId}`, key, async (tx) => {
      await this.windows.requireAllowedWithClient(tx, input.seasonId, 'TRANSFER', at);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM league_player_ownerships WHERE id = ${input.ownershipId} FOR UPDATE`);
      const ownership = await tx.leaguePlayerOwnership.findUnique({ where: { id: input.ownershipId }, include: { footballPlayer: true, leagueTeam: true } });
      if (!ownership || ownership.leagueId !== scope.leagueId || ownership.status !== 'ACTIVE') {
        throw new LeagueError('TRANSFER_OWNERSHIP_NOT_FOUND', '球员不在可转会阵容中', 404);
      }
      if (ownership.version !== input.expectedOwnershipVersion) throw new LeagueError('TRANSFER_OWNERSHIP_CHANGED', '球员归属已变化', 409);
      const sourceTeamId = ownership.leagueTeamId;
      if (input.targetTeamId === sourceTeamId) throw new LeagueError('TRANSFER_SELF_NOT_ALLOWED', '不能向本队转会', 400);
      if (input.initiatorTeamId !== sourceTeamId && input.initiatorTeamId !== input.targetTeamId) {
        throw new LeagueError('TRANSFER_PARTICIPANT_REQUIRED', '只能由转出或转入球队发起', 403);
      }
      const target = await tx.leagueTeam.findUnique({ where: { id: input.targetTeamId }, include: { seasonEntries: { where: { seasonId: input.seasonId, status: 'APPROVED' }, take: 1 } } });
      if (!target || target.leagueId !== scope.leagueId || target.status !== 'ACTIVE' || target.seasonEntries.length === 0) {
        throw new LeagueError('TRANSFER_TARGET_INVALID', '目标球队未参加本赛季', 409);
      }
      const pending = await tx.transferProposal.findFirst({ where: { ownershipId: ownership.id, status: { in: ['PENDING_COUNTERPARTY', 'PENDING_ADMIN'] } }, select: { id: true } });
      if (pending) throw new LeagueError('TRANSFER_PROPOSAL_EXISTS', '该球员已有待处理转会申请', 409);
      const proposal = await tx.transferProposal.create({ data: {
        leagueId: scope.leagueId, seasonId: input.seasonId, ownershipId: ownership.id, sourceTeamId,
        targetTeamId: input.targetTeamId, initiatorTeamId: input.initiatorTeamId, initiatorUserId: userId,
        expectedOwnershipVersion: ownership.version, amountMinor: input.amountMinor, reason: input.reason ?? null
      }, include });
      await tx.transferProposalEvent.create({ data: { proposalId: proposal.id, toStatus: 'PENDING_COUNTERPARTY', actorUserId: userId, reason: input.reason ?? null, createdAt: at } });
      return this.present(proposal);
    });
  }

  async respond(userId: string, id: string, raw: RespondTransferProposal, key: string, at = new Date()) {
    const input = RespondTransferProposalSchema.parse(raw);
    const current = await this.prisma.transferProposal.findUnique({ where: { id }, select: { leagueId: true, seasonId: true } });
    if (!current) throw new LeagueError('TRANSFER_PROPOSAL_NOT_FOUND', '转会申请不存在', 404);
    const scope = await this.access.requireParticipant(userId, current.leagueId, current.seasonId);
    return this.receipts.execute(userId, `transfer.respond:${id}`, key, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM transfer_proposals WHERE id = ${id} FOR UPDATE`);
      const proposal = await tx.transferProposal.findUnique({ where: { id }, include });
      if (!proposal || proposal.status !== 'PENDING_COUNTERPARTY' || proposal.version !== input.expectedVersion) {
        throw new LeagueError('TRANSFER_PROPOSAL_CHANGED', '申请已变化，请刷新', 409);
      }
      const counterpartyId = proposal.initiatorTeamId === proposal.sourceTeamId ? proposal.targetTeamId : proposal.sourceTeamId;
      if (input.decision === 'WITHDRAW' ? scope.leagueTeamId !== proposal.initiatorTeamId : scope.leagueTeamId !== counterpartyId) {
        throw new LeagueError('TRANSFER_RESPONSE_FORBIDDEN', '只有对应球队可以操作此申请', 403);
      }
      if (input.decision === 'CONFIRM') {
        await this.windows.requireAllowedWithClient(tx, proposal.seasonId, 'TRANSFER', at);
        if (proposal.ownership.status !== 'ACTIVE' || proposal.ownership.version !== proposal.expectedOwnershipVersion || proposal.ownership.leagueTeamId !== proposal.sourceTeamId) {
          throw new LeagueError('TRANSFER_OWNERSHIP_CHANGED', '球员归属已变化', 409);
        }
      }
      const status = input.decision === 'CONFIRM' ? 'PENDING_ADMIN' : input.decision === 'REJECT' ? 'REJECTED' : 'WITHDRAWN';
      const changed = await tx.transferProposal.updateMany({ where: { id, version: input.expectedVersion, status: 'PENDING_COUNTERPARTY' },
        data: { status, counterpartyUserId: input.decision === 'WITHDRAW' ? null : userId, version: { increment: 1 } } });
      if (changed.count !== 1) throw new LeagueError('TRANSFER_PROPOSAL_CHANGED', '申请已变化，请刷新', 409);
      await tx.transferProposalEvent.create({ data: { proposalId: id, fromStatus: 'PENDING_COUNTERPARTY', toStatus: status,
        actorUserId: userId, reason: input.reason ?? null, createdAt: at } });
      return this.present({ ...proposal, status, version: proposal.version + 1, counterpartyUserId: input.decision === 'WITHDRAW' ? null : userId });
    });
  }

  private present(proposal: ProposalWithRelations) {
    return { id: proposal.id, leagueId: proposal.leagueId, seasonId: proposal.seasonId, ownershipId: proposal.ownershipId,
      playerName: proposal.ownership.footballPlayer.nameZh ?? proposal.ownership.footballPlayer.nameEn ?? '未知球员',
      sourceTeamId: proposal.sourceTeamId, sourceTeamName: proposal.sourceTeam.name, sourceTeamNumber: proposal.sourceTeam.teamNumber,
      targetTeamId: proposal.targetTeamId, targetTeamName: proposal.targetTeam.name, targetTeamNumber: proposal.targetTeam.teamNumber,
      initiatorTeamId: proposal.initiatorTeamId, amountMinor: proposal.amountMinor, status: proposal.status,
      reason: proposal.reason, reviewReason: proposal.reviewReason, version: proposal.version,
      createdAt: proposal.createdAt.toISOString(), reviewedAt: proposal.reviewedAt?.toISOString() ?? null };
  }
}
