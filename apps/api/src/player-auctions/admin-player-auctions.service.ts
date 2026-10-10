import { Inject, Injectable } from '@nestjs/common';
import type {
  CancelPlayerAuctionBatchRequest,
  CreatePlayerAuctionBatchRequest,
  PreparePlayerAuctionBatchRequest,
  ReplacePlayerAuctionLotsRequest,
  ReviewPlayerAuctionLotRequest,
  UpdatePlayerAuctionBatchRequest
} from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PlayerAuctionError, auctionVersionConflict } from './player-auction.errors.js';

const DETAIL_INCLUDE = {
  groupBinding: { select: { displayName: true } },
  lots: {
    include: {
      bids: { include: { leagueTeam: { select: { name: true } } }, orderBy: [{ wechatSentAt: 'asc' }, { wechatSortKey: 'asc' }, { wechatMessageId: 'asc' }] },
      review: {
        include: {
          computedWinnerTeam: { select: { name: true } },
          reviewedWinnerTeam: { select: { name: true } }
        }
      },
      currentHighestBid: { include: { leagueTeam: { select: { name: true } } } }
    },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }]
  }
} satisfies Prisma.PlayerAuctionBatchInclude;

type AuctionClient = Prisma.TransactionClient | PrismaService;
type BatchRecord = Prisma.PlayerAuctionBatchGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type BatchSummaryInput = Pick<BatchRecord, 'id' | 'leagueId' | 'groupBindingId' | 'name' | 'status' | 'currentLotId' | 'version' | 'createdAt' | 'updatedAt' | 'groupBinding'> & {
  _count?: { lots: number };
  lots?: BatchRecord['lots'];
};
type LotRecord = BatchRecord['lots'][number];
type ReviewRecord = NonNullable<LotRecord['review']>;

@Injectable()
export class AdminPlayerAuctionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async list(actorAdminId: string, leagueId: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    const batches = await this.prisma.playerAuctionBatch.findMany({
      where: { leagueId },
      include: { groupBinding: { select: { displayName: true } }, _count: { select: { lots: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    return { items: batches.map((batch) => this.summary(batch)) };
  }

  async detail(actorAdminId: string, leagueId: string, batchId: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.view(await this.batch(this.prisma, leagueId, batchId));
  }

  async create(actorAdminId: string, leagueId: string, input: CreatePlayerAuctionBatchRequest, key: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(actorAdminId, `admin.player-auction.create:${leagueId}`, key, async (tx) => {
      const group = await tx.wechatGroupBinding.findFirst({
        where: {
          id: input.groupBindingId,
          leagueId,
          enabled: true,
          capabilities: { some: { capability: 'PLAYER_AUCTION' } }
        }
      });
      if (!group) throw new PlayerAuctionError('AUCTION_GROUP_INVALID', '微信群未启用、未开启球员拍卖或不属于当前联赛', 409);
      if (group.version !== input.expectedVersion) throw auctionVersionConflict();
      const created = await tx.playerAuctionBatch.create({
        data: { leagueId, groupBindingId: group.id, name: input.name, createdByAdminId: actorAdminId }
      });
      await this.audit.record(tx, {
        actorAdminId, leagueId, action: 'admin.player-auction.create',
        resourceType: 'PlayerAuctionBatch', resourceId: created.id,
        metadata: { groupBindingId: group.id, name: input.name }
      });
      return this.view(await this.batch(tx, leagueId, created.id));
    }, input);
  }

  async update(actorAdminId: string, leagueId: string, batchId: string, input: UpdatePlayerAuctionBatchRequest, key: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(actorAdminId, `admin.player-auction.update:${batchId}`, key, async (tx) => {
      const batch = await this.batch(tx, leagueId, batchId);
      this.requireDraft(batch);
      const updated = await tx.playerAuctionBatch.updateMany({
        where: { id: batchId, leagueId, version: input.expectedVersion, status: 'DRAFT' },
        data: { name: input.name, version: { increment: 1 } }
      });
      if (updated.count !== 1) throw auctionVersionConflict();
      return this.view(await this.batch(tx, leagueId, batchId));
    }, input);
  }

  async replaceLots(actorAdminId: string, leagueId: string, batchId: string, input: ReplacePlayerAuctionLotsRequest, key: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(actorAdminId, `admin.player-auction.replace-lots:${batchId}`, key, async (tx) => {
      const batch = await this.batch(tx, leagueId, batchId);
      this.requireDraft(batch);
      if (batch.version !== input.expectedVersion) throw auctionVersionConflict();
      const playerIds = [...new Set(input.lots.map((lot) => lot.playerId))];
      const cardIds = [...new Set(input.lots.flatMap((lot) => lot.playerCardId ? [lot.playerCardId] : []))];
      const [players, cards] = await Promise.all([
        tx.footballPlayer.findMany({ where: { id: { in: playerIds }, publishedAt: { not: null } } }),
        cardIds.length ? tx.playerCard.findMany({ where: { id: { in: cardIds }, status: 'ACTIVE', publishedAt: { not: null } } }) : []
      ]);
      const playerById = new Map(players.map((player) => [player.id, player]));
      const cardById = new Map(cards.map((card) => [card.id, card]));
      if (players.length !== playerIds.length) {
        throw new PlayerAuctionError('AUCTION_PLAYER_INVALID', '球员不存在或尚未发布', 409);
      }
      for (const lot of input.lots) {
        const card = lot.playerCardId ? cardById.get(lot.playerCardId) : undefined;
        if (lot.playerCardId && (!card || card.playerId !== lot.playerId)) {
          throw new PlayerAuctionError('AUCTION_CARD_INVALID', '球员卡不存在、不可用或不属于该球员', 409);
        }
      }
      await tx.playerAuctionLot.deleteMany({ where: { batchId } });
      await tx.playerAuctionLot.createMany({
        data: input.lots.map((lot) => {
          const player = playerById.get(lot.playerId)!;
          const card = lot.playerCardId ? cardById.get(lot.playerCardId) : undefined;
          const playerNameSnapshot = player.nameZh ?? player.nameEn ?? player.shortName ?? player.id;
          return {
            batchId,
            footballPlayerId: player.id,
            playerCardId: card?.id ?? null,
            displayOrder: lot.displayOrder,
            playerNameSnapshot,
            playerSnapshot: {
              nameZh: player.nameZh, nameEn: player.nameEn, nationality: player.nationality,
              club: player.club, card: card ? {
                cardName: card.cardName, position: card.position,
                overallRating: card.overallRating, cardType: card.cardType
              } : null
            },
            startingPrice: lot.startingPrice,
            minimumIncrement: lot.minimumIncrement
          };
        })
      });
      const updated = await tx.playerAuctionBatch.updateMany({
        where: { id: batchId, version: input.expectedVersion, status: 'DRAFT' },
        data: { version: { increment: 1 } }
      });
      if (updated.count !== 1) throw auctionVersionConflict();
      return this.view(await this.batch(tx, leagueId, batchId));
    }, input);
  }

  async prepare(actorAdminId: string, leagueId: string, batchId: string, input: PreparePlayerAuctionBatchRequest, key: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(actorAdminId, `admin.player-auction.prepare:${batchId}`, key, async (tx) => {
      const batch = await this.batch(tx, leagueId, batchId);
      this.requireDraft(batch);
      if (batch.lots.length === 0) throw new PlayerAuctionError('AUCTION_LOTS_REQUIRED', '至少配置一名拍卖球员', 409);
      await tx.$queryRaw`SELECT id FROM wechat_group_bindings WHERE id = ${batch.groupBindingId} FOR UPDATE`;
      const group = await tx.wechatGroupBinding.findFirst({
        where: {
          id: batch.groupBindingId,
          leagueId,
          enabled: true,
          capabilities: { some: { capability: 'PLAYER_AUCTION' } }
        },
        select: { id: true }
      });
      if (!group) {
        throw new PlayerAuctionError('AUCTION_GROUP_INVALID', '微信群未启用、未开启球员拍卖或不属于当前联赛', 409);
      }
      const conflict = await tx.playerAuctionBatch.findFirst({
        where: {
          groupBindingId: batch.groupBindingId,
          id: { not: batchId },
          status: { in: ['READY', 'ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED'] }
        },
        select: { id: true }
      });
      if (conflict) throw new PlayerAuctionError('AUCTION_GROUP_BUSY', '该微信群已有未结束的拍卖', 409);
      const updated = await tx.playerAuctionBatch.updateMany({
        where: { id: batchId, leagueId, version: input.expectedVersion, status: 'DRAFT' },
        data: { status: 'READY', version: { increment: 1 } }
      });
      if (updated.count !== 1) throw auctionVersionConflict();
      await this.audit.record(tx, {
        actorAdminId, leagueId, action: 'admin.player-auction.prepare',
        resourceType: 'PlayerAuctionBatch', resourceId: batchId,
        metadata: { lotCount: batch.lots.length, groupBindingId: batch.groupBindingId }
      });
      return this.view(await this.batch(tx, leagueId, batchId));
    }, input);
  }

  async cancel(actorAdminId: string, leagueId: string, batchId: string, input: CancelPlayerAuctionBatchRequest, key: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(actorAdminId, `admin.player-auction.cancel:${batchId}`, key, async (tx) => {
      const batch = await this.batch(tx, leagueId, batchId);
      if (['COMPLETED', 'CANCELLED'].includes(batch.status)) {
        throw new PlayerAuctionError('AUCTION_CANNOT_CANCEL', '已结束的拍卖不能取消', 409);
      }
      const now = new Date();
      const updated = await tx.playerAuctionBatch.updateMany({
        where: { id: batchId, leagueId, version: input.expectedVersion, status: batch.status },
        data: { status: 'CANCELLED', currentLotId: null, cancelledAt: now, version: { increment: 1 } }
      });
      if (updated.count !== 1) throw auctionVersionConflict();
      await tx.playerAuctionLot.updateMany({
        where: { batchId, status: { in: ['QUEUED', 'ACTIVE', 'PAUSED'] } },
        data: { status: 'VOID', deadlineAt: null, pausedRemainingMs: null, closedAt: now, deadlineEpoch: { increment: 1 }, version: { increment: 1 } }
      });
      await this.audit.record(tx, {
        actorAdminId, leagueId, action: 'admin.player-auction.cancel', resourceType: 'PlayerAuctionBatch',
        resourceId: batchId, reason: input.reason, metadata: { previousStatus: batch.status }
      });
      return this.view(await this.batch(tx, leagueId, batchId));
    }, input);
  }

  async reviewLot(
    actorAdminId: string,
    leagueId: string,
    batchId: string,
    lotId: string,
    input: ReviewPlayerAuctionLotRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(actorAdminId, `admin.player-auction.review:${lotId}`, key, async (tx) => {
      await this.batch(tx, leagueId, batchId);
      const lot = await tx.playerAuctionLot.findFirst({
        where: { id: lotId, batchId, batch: { leagueId } },
        include: { currentHighestBid: { include: { leagueTeam: { select: { name: true } } } }, review: true }
      });
      if (!lot) throw new PlayerAuctionError('AUCTION_LOT_NOT_FOUND', '拍卖球员不存在', 404);
      if (!['PENDING_REVIEW', 'NO_BID'].includes(lot.status) || lot.review) {
        throw new PlayerAuctionError('AUCTION_REVIEW_NOT_ALLOWED', '当前拍卖结果不能审核', 409);
      }
      if (lot.version !== input.expectedVersion) throw auctionVersionConflict();
      if (lot.status === 'NO_BID' && input.decision === 'ADJUST') {
        throw new PlayerAuctionError('AUCTION_REVIEW_NOT_ALLOWED', '无人出价结果不能调整为成交结果', 409);
      }
      let reviewedTeamId = lot.currentHighestBid?.leagueTeamId ?? null;
      let reviewedPrice = lot.currentPrice;
      if (input.decision === 'ADJUST') {
        const team = await tx.leagueTeam.findFirst({ where: { id: input.reviewedTeamId, leagueId, status: 'ACTIVE' } });
        if (!team) throw new PlayerAuctionError('AUCTION_REVIEW_TEAM_INVALID', '调整后的球队不属于当前联赛', 409);
        reviewedTeamId = team.id;
        reviewedPrice = input.reviewedPrice;
      } else if (input.decision === 'VOID') {
        reviewedTeamId = null;
        reviewedPrice = null;
      }
      const review = await tx.playerAuctionReview.create({
        data: {
          lotId,
          decision: input.decision,
          computedWinnerTeamId: lot.currentHighestBid?.leagueTeamId ?? null,
          computedPrice: lot.currentPrice,
          reviewedWinnerTeamId: reviewedTeamId,
          reviewedPrice,
          reviewedByAdminId: actorAdminId,
          reason: input.reason ?? null
        },
        include: {
          computedWinnerTeam: { select: { name: true } },
          reviewedWinnerTeam: { select: { name: true } }
        }
      });
      const update = await tx.playerAuctionLot.updateMany({
        where: { id: lotId, batchId, version: input.expectedVersion, status: lot.status },
        data: { status: input.decision === 'VOID' ? 'VOID' : 'REVIEWED', reviewedAt: review.reviewedAt, version: { increment: 1 } }
      });
      if (update.count !== 1) throw auctionVersionConflict();
      await this.audit.record(tx, {
        actorAdminId, leagueId, action: 'admin.player-auction.review', resourceType: 'PlayerAuctionLot',
        resourceId: lotId, reason: input.reason ?? null,
        metadata: { decision: input.decision, computedWinnerTeamId: lot.currentHighestBid?.leagueTeamId ?? null, computedPrice: lot.currentPrice, reviewedWinnerTeamId: reviewedTeamId, reviewedPrice }
      });
      return { lotId, status: input.decision === 'VOID' ? 'VOID' : 'REVIEWED', review: this.reviewView(review) };
    }, input);
  }

  private async batch(client: AuctionClient, leagueId: string, batchId: string): Promise<BatchRecord> {
    const batch = await client.playerAuctionBatch.findFirst({ where: { id: batchId, leagueId }, include: DETAIL_INCLUDE });
    if (!batch) throw new PlayerAuctionError('AUCTION_NOT_FOUND', '拍卖批次不存在', 404);
    return batch;
  }

  private requireDraft(batch: { status: string }) {
    if (batch.status !== 'DRAFT') throw new PlayerAuctionError('AUCTION_DRAFT_REQUIRED', '只有草稿拍卖可以编辑', 409);
  }

  private summary(batch: BatchSummaryInput) {
    return {
      id: batch.id, leagueId: batch.leagueId, groupBindingId: batch.groupBindingId,
      groupDisplayName: batch.groupBinding.displayName, name: batch.name, status: batch.status,
      lotCount: batch._count?.lots ?? batch.lots?.length ?? 0, currentLotId: batch.currentLotId,
      version: batch.version, createdAt: batch.createdAt.toISOString(), updatedAt: batch.updatedAt.toISOString()
    };
  }

  private view(batch: BatchRecord) {
    return {
      id: batch.id, leagueId: batch.leagueId, groupBindingId: batch.groupBindingId,
      name: batch.name, status: batch.status, currentLotId: batch.currentLotId, version: batch.version,
      startedAt: batch.startedAt?.toISOString() ?? null, completedAt: batch.completedAt?.toISOString() ?? null,
      cancelledAt: batch.cancelledAt?.toISOString() ?? null, createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(), lots: batch.lots.map((lot) => this.lotView(lot))
    };
  }

  private lotView(lot: LotRecord) {
    return {
      id: lot.id, displayOrder: lot.displayOrder, playerId: lot.footballPlayerId,
      playerCardId: lot.playerCardId, playerName: lot.playerNameSnapshot,
      playerSnapshot: lot.playerSnapshot, startingPrice: lot.startingPrice,
      minimumIncrement: lot.minimumIncrement, status: lot.status, currentPrice: lot.currentPrice,
      currentHighestBidId: lot.currentHighestBidId, deadlineAt: lot.deadlineAt?.toISOString() ?? null,
      deadlineEpoch: lot.deadlineEpoch, pausedRemainingMs: lot.pausedRemainingMs, version: lot.version,
      bids: lot.bids.map((bid) => ({
        id: bid.id, leagueTeamId: bid.leagueTeamId, teamName: bid.leagueTeam?.name ?? null,
        userId: bid.userId, amount: bid.amount, result: bid.result, rejectionReason: bid.rejectionReason,
        wechatMessageId: bid.wechatMessageId, wechatSortKey: bid.wechatSortKey,
        wechatSentAt: bid.wechatSentAt.toISOString(), receivedAt: bid.receivedAt.toISOString()
      })),
      review: lot.review ? this.reviewView(lot.review) : null,
      startedAt: lot.startedAt?.toISOString() ?? null, closedAt: lot.closedAt?.toISOString() ?? null,
      reviewedAt: lot.reviewedAt?.toISOString() ?? null
    };
  }

  private reviewView(review: ReviewRecord) {
    return {
      id: review.id, decision: review.decision, computedWinnerTeamId: review.computedWinnerTeamId,
      computedWinnerTeamName: review.computedWinnerTeam?.name ?? null, computedPrice: review.computedPrice,
      reviewedWinnerTeamId: review.reviewedWinnerTeamId,
      reviewedWinnerTeamName: review.reviewedWinnerTeam?.name ?? null, reviewedPrice: review.reviewedPrice,
      reason: review.reason, reviewedByAdminId: review.reviewedByAdminId,
      reviewedAt: review.reviewedAt.toISOString()
    };
  }
}
