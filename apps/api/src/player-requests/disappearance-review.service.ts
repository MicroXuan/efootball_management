import { Inject, Injectable } from '@nestjs/common';
import { ReviewDisappearanceRequestSchema, type ReviewDisappearanceRequest } from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeagueError } from '../leagues/league.errors.js';
import { RosterTransactionsService } from '../league-rosters/roster-transactions.service.js';

const include = {
  ownership: { include: { footballPlayer: true } },
  requesterTeam: true,
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }
} satisfies Prisma.DisappearanceRequestInclude;
type RequestWithRelations = Prisma.DisappearanceRequestGetPayload<{ include: typeof include }>;

@Injectable()
export class DisappearanceReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(RosterTransactionsService) private readonly roster: RosterTransactionsService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async list(adminId: string, leagueId: string, status?: string) {
    await this.authorization.requireLeagueManager(adminId, leagueId);
    const items = await this.prisma.disappearanceRequest.findMany({
      where: { leagueId, ...(status ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'INVALIDATED' } : {}) },
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    return { items: items.map((item) => this.present(item)) };
  }

  async review(adminId: string, leagueId: string, id: string, raw: ReviewDisappearanceRequest, key: string, at = new Date()) {
    const input = ReviewDisappearanceRequestSchema.parse(raw);
    await this.authorization.requireLeagueManager(adminId, leagueId);
    return this.receipts.execute(adminId, `DISAPPEARANCE_REVIEW:${id}`, key, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM disappearance_requests WHERE id = ${id} FOR UPDATE`);
      const request = await tx.disappearanceRequest.findUnique({ where: { id }, include });
      if (!request || request.leagueId !== leagueId) throw new LeagueError('DISAPPEARANCE_REQUEST_NOT_FOUND', '申请不存在', 404);
      if (request.status !== 'PENDING' || request.version !== input.expectedVersion) {
        throw new LeagueError('DISAPPEARANCE_REVIEW_CONFLICT', '申请状态已变化，请刷新后重试', 409);
      }
      if (input.decision === 'APPROVE') {
        if (request.ownership.status !== 'ACTIVE' || request.ownership.version !== request.expectedOwnershipVersion || request.ownership.leagueTeamId !== request.requesterTeamId) {
          throw new LeagueError('DISAPPEARANCE_OWNERSHIP_CHANGED', '球员归属已变化，不能批准该申请', 409);
        }
        await this.roster.updateLifecycleStatusWithClient(tx, {
          seasonId: request.seasonId, ownershipId: request.ownershipId, status: 'DISAPPEARED',
          reason: input.reason, expectedVersion: request.expectedOwnershipVersion
        }, adminId);
      }
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const changed = await tx.disappearanceRequest.updateMany({
        where: { id, version: input.expectedVersion, status: 'PENDING' },
        data: { status, reviewReason: input.reason, reviewedByAdminId: adminId, reviewedAt: at, version: { increment: 1 } }
      });
      if (changed.count !== 1) throw new LeagueError('DISAPPEARANCE_REVIEW_CONFLICT', '申请状态已变化，请刷新后重试', 409);
      const event = await tx.disappearanceRequestEvent.create({
        data: { requestId: id, fromStatus: 'PENDING', toStatus: status, actorAdminId: adminId, reason: input.reason, createdAt: at }
      });
      await this.audit.record(tx, {
        actorAdminId: adminId, leagueId, action: 'DISAPPEARANCE_REQUEST_REVIEWED',
        resourceType: 'DISAPPEARANCE_REQUEST', resourceId: id, reason: input.reason,
        metadata: { decision: input.decision, ownershipId: request.ownershipId, requesterTeamId: request.requesterTeamId }
      });
      return this.present({ ...request, status, version: request.version + 1, reviewReason: input.reason, reviewedAt: at,
        events: [...request.events, event] });
    }, input);
  }

  private present(request: RequestWithRelations) {
    return {
      id: request.id, leagueId: request.leagueId, seasonId: request.seasonId, ownershipId: request.ownershipId,
      requesterTeamId: request.requesterTeamId, requesterTeamName: request.requesterTeam.name,
      requesterTeamNumber: request.requesterTeam.teamNumber,
      playerName: request.ownership.footballPlayer.nameZh ?? request.ownership.footballPlayer.nameEn ?? '未知球员',
      status: request.status, reason: request.reason, reviewReason: request.reviewReason, version: request.version,
      createdAt: request.createdAt.toISOString(), reviewedAt: request.reviewedAt?.toISOString() ?? null,
      events: request.events.map((event) => ({ id: event.id, fromStatus: event.fromStatus, toStatus: event.toStatus,
        reason: event.reason, createdAt: event.createdAt.toISOString() }))
    };
  }
}
