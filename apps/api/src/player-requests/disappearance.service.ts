import { Inject, Injectable } from '@nestjs/common';
import { SubmitDisappearanceRequestSchema, type DisappearanceRequest, type SubmitDisappearanceRequest } from '@efm/contracts';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type DisappearanceRequest as DbRequest } from '../generated/prisma/client.js';
import { LeagueError } from '../leagues/league.errors.js';
import { PlayerMarketAccessService } from '../player-market/player-market-access.service.js';

type RequestWithPlayer = DbRequest & { ownership?: { footballPlayer?: { nameZh: string | null; nameEn: string | null } } };

@Injectable()
export class DisappearanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerMarketAccessService) private readonly access: PlayerMarketAccessService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService
  ) {}

  async listMine(userId: string, seasonId: string): Promise<{ items: DisappearanceRequest[] }> {
    const requests = await this.prisma.disappearanceRequest.findMany({
      where: { requesterUserId: userId, seasonId },
      include: { ownership: { include: { footballPlayer: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    return { items: requests.map((request) => this.present(request)) };
  }

  async submit(userId: string, teamId: string, ownershipId: string, raw: SubmitDisappearanceRequest, key: string, at?: Date): Promise<DisappearanceRequest> {
    const input = SubmitDisappearanceRequestSchema.parse(raw);
    const scope = await this.access.requireOwnedTeam(userId, teamId, input.seasonId);
    return this.receipts.execute(userId, `disappearance.submit:${ownershipId}`, key, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM league_player_ownerships WHERE id = ${ownershipId} FOR UPDATE`);
      const ownership = await tx.leaguePlayerOwnership.findUnique({ where: { id: ownershipId }, include: { footballPlayer: true } });
      if (!ownership || ownership.leagueTeamId !== teamId || ownership.leagueId !== scope.leagueId) {
        throw new LeagueError('OWNERSHIP_NOT_FOUND', '球员不在你的球队阵容中', 404);
      }
      if (ownership.version !== input.expectedOwnershipVersion) {
        throw new LeagueError('OWNERSHIP_VERSION_CONFLICT', '球员状态已变化，请刷新后重试', 409);
      }
      if (ownership.status !== 'ACTIVE') {
        throw new LeagueError('DISAPPEARANCE_NOT_ALLOWED', '只有现役球员可以申请标记消失', 409);
      }
      const pending = await tx.disappearanceRequest.findFirst({ where: { ownershipId, status: 'PENDING' }, select: { id: true } });
      if (pending) throw new LeagueError('DISAPPEARANCE_REQUEST_EXISTS', '该球员已有待审核申请', 409);
      const request = await tx.disappearanceRequest.create({
        data: { leagueId: scope.leagueId, seasonId: input.seasonId, ownershipId, requesterTeamId: teamId,
          requesterUserId: userId, expectedOwnershipVersion: ownership.version, reason: input.reason },
      });
      await tx.disappearanceRequestEvent.create({
        data: { requestId: request.id, toStatus: 'PENDING', actorUserId: userId, reason: input.reason, createdAt: at ?? new Date() }
      });
      return this.present({ ...request, ownership });
    });
  }

  private present(request: RequestWithPlayer): DisappearanceRequest {
    return {
      id: request.id, leagueId: request.leagueId, seasonId: request.seasonId, ownershipId: request.ownershipId,
      requesterTeamId: request.requesterTeamId,
      playerName: request.ownership?.footballPlayer?.nameZh ?? request.ownership?.footballPlayer?.nameEn ?? '未知球员',
      status: request.status, reason: request.reason, reviewReason: request.reviewReason,
      version: request.version, createdAt: request.createdAt.toISOString(), reviewedAt: request.reviewedAt?.toISOString() ?? null
    };
  }
}
