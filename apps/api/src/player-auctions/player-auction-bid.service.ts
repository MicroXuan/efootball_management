import { Inject, Injectable } from '@nestjs/common';
import type { PlaceMiniprogramAuctionBidRequest } from '@efm/contracts';
import type {
  LeagueTeam,
  PlayerAuctionBatch,
  PlayerAuctionBidChannel,
  PlayerAuctionBidResult,
  PlayerAuctionLot,
  Prisma
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerAuctionError } from './player-auction.errors.js';
import { PlayerAuctionLockRepository } from './player-auction-lock.repository.js';

const MAX_AMOUNT = 2_147_483_647;

type ArbitrationIdentity = {
  userId: string | null;
  identityBindingId: string | null;
  team: LeagueTeam | null;
  identityStatus: 'ACTIVE' | 'INACTIVE' | 'UNBOUND';
};

type ArbitrationMetadata = {
  source: PlayerAuctionBidChannel;
  inboundMessageId: string | null;
  idempotencyKey: string | null;
  wechatMessageId: string | null;
  wechatSortKey: string | null;
  wechatSentAt: Date | null;
  submittedAt: Date;
  receivedAt: Date;
};

@Injectable()
export class PlayerAuctionBidService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAuctionLockRepository) private readonly locks: PlayerAuctionLockRepository
  ) {}

  placeBid(inboundMessageId: string, amount: number) {
    return this.prisma.$transaction(async (tx) => {
      const inbound = await tx.wechatInboundMessage.findUnique({
        where: { id: inboundMessageId },
        include: { groupBinding: { select: { id: true, leagueId: true } } }
      });
      if (!inbound?.groupBindingId || !inbound.groupBinding) {
        throw new PlayerAuctionError('AUCTION_GROUP_INVALID', '消息不属于已绑定的微信群', 409);
      }
      await this.locks.lockLeague(tx, inbound.groupBinding.leagueId);
      await this.locks.lockGroup(tx, inbound.groupBindingId);
      const duplicate = await tx.playerAuctionBid.findUnique({ where: { inboundMessageId } });
      if (duplicate) return { ...duplicate, result: 'DUPLICATE' as const };
      const batch = await tx.playerAuctionBatch.findFirst({
        where: {
          groupBindingId: inbound.groupBindingId,
          status: { in: ['ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED'] }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      });
      if (!batch?.currentLotId) {
        throw new PlayerAuctionError('AUCTION_INACTIVE', '当前没有进行中的拍卖', 409);
      }
      if (batch.bidChannel !== 'WECHAT_GROUP') {
        throw new PlayerAuctionError('AUCTION_CHANNEL_MISMATCH', '当前拍卖仅接受小程序出价', 409);
      }

      await this.locks.lockBatch(tx, batch.id);
      await this.locks.lockLot(tx, batch.currentLotId);
      const lot = await tx.playerAuctionLot.findUnique({ where: { id: batch.currentLotId } });
      if (!lot) throw new PlayerAuctionError('AUCTION_INACTIVE', '当前没有进行中的拍卖', 409);
      const now = await this.locks.now(tx);
      // Serialize with administrator reassignment and self-unbinding until the bid commits.
      await tx.$queryRaw`SELECT id FROM wechat_identity_bindings WHERE device_id = ${inbound.deviceId} AND wechat_contact_id = ${inbound.senderId} FOR UPDATE`;
      const currentIdentity = await tx.wechatIdentityBinding.findFirst({
        where: { deviceId: inbound.deviceId, wechatContactId: inbound.senderId, status: 'ACTIVE' },
        include: { user: { select: { status: true } } }
      });
      // Offline messages must not acquire an identity granted after they were sent.
      const identity = currentIdentity && currentIdentity.boundAt <= inbound.wechatSentAt ? currentIdentity : null;
      let team = identity
        ? await tx.leagueTeam.findFirst({
            where: { ownerUserId: identity.userId, leagueId: batch.leagueId, status: 'ACTIVE' }
          })
        : null;
      const identityStatus: ArbitrationIdentity['identityStatus'] = !identity
        ? 'UNBOUND'
        : identity.user.status === 'ACTIVE'
          ? 'ACTIVE'
          : 'INACTIVE';
      if (identity && !team) {
        team = await tx.leagueTeam.findFirst({
          where: { ownerUserId: identity.userId, status: 'ACTIVE' }
        });
      }

      return this.arbitrate(tx, batch, lot, amount, now, {
        userId: identity?.userId ?? null,
        identityBindingId: identity?.id ?? null,
        team,
        identityStatus
      }, {
        source: 'WECHAT_GROUP',
        inboundMessageId,
        idempotencyKey: null,
        wechatMessageId: inbound.messageId,
        wechatSortKey: inbound.sequence ?? inbound.messageId,
        wechatSentAt: inbound.wechatSentAt,
        submittedAt: inbound.wechatSentAt,
        receivedAt: inbound.receivedAt
      });
    }, { isolationLevel: 'ReadCommitted' });
  }

  placeMiniprogramBid(
    userId: string,
    batchId: string,
    input: PlaceMiniprogramAuctionBidRequest,
    idempotencyKey: string
  ) {
    if (!idempotencyKey.trim() || idempotencyKey.length > 128) {
      throw new PlayerAuctionError('IDEMPOTENCY_KEY_REQUIRED', '缺少幂等请求标识', 400);
    }
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await tx.playerAuctionBatch.findUnique({ where: { id: batchId } });
      if (!snapshot) throw new PlayerAuctionError('AUCTION_NOT_FOUND', '拍卖批次不存在', 404);
      const replay = await tx.playerAuctionBid.findUnique({
        where: {
          lotId_userId_idempotencyKey: {
            lotId: input.lotId,
            userId,
            idempotencyKey
          }
        },
        include: { leagueTeam: { select: { name: true } } }
      });
      if (replay) {
        return {
          ...replay,
          teamName: replay.leagueTeam?.name ?? null,
          deadlineAt: null,
          requiredMinimum: undefined
        };
      }
      const lotSnapshot = await tx.playerAuctionLot.findUnique({ where: { id: input.lotId } });
      if (
        snapshot.currentLotId !== input.lotId ||
        !lotSnapshot || lotSnapshot.batchId !== snapshot.id || lotSnapshot.deadlineEpoch !== input.deadlineEpoch
      ) {
        throw new PlayerAuctionError('AUCTION_EPOCH_CHANGED', '当前拍卖倒计时已变化，请刷新后重试', 409);
      }

      await this.locks.lockLeague(tx, snapshot.leagueId);
      await this.locks.lockBatch(tx, batchId);
      const batch = await tx.playerAuctionBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new PlayerAuctionError('AUCTION_NOT_FOUND', '拍卖批次不存在', 404);
      if (batch.bidChannel !== 'MINIPROGRAM') {
        throw new PlayerAuctionError('AUCTION_CHANNEL_MISMATCH', '当前拍卖仅接受微信群出价', 409);
      }

      const duplicate = await tx.playerAuctionBid.findUnique({
        where: {
          lotId_userId_idempotencyKey: {
            lotId: input.lotId,
            userId,
            idempotencyKey
          }
        },
        include: { leagueTeam: { select: { name: true } } }
      });
      if (duplicate) {
        return {
          ...duplicate,
          teamName: duplicate.leagueTeam?.name ?? null,
          deadlineAt: null,
          requiredMinimum: undefined
        };
      }

      if (batch.currentLotId !== input.lotId) {
        throw new PlayerAuctionError('AUCTION_EPOCH_CHANGED', '当前拍卖球员已变化，请刷新后重试', 409);
      }
      await this.locks.lockLot(tx, input.lotId);
      const lot = await tx.playerAuctionLot.findUnique({ where: { id: input.lotId } });
      if (!lot || lot.batchId !== batch.id) {
        throw new PlayerAuctionError('AUCTION_EPOCH_CHANGED', '拍卖倒计时已变化，请刷新后重试', 409);
      }
      const now = await this.locks.now(tx);
      const team = await tx.leagueTeam.findFirst({
        where: { ownerUserId: userId, leagueId: batch.leagueId, status: 'ACTIVE' }
      });
      if (!team) {
        throw new PlayerAuctionError('NO_ACTIVE_TEAM', '没有当前联赛的有效球队', 409);
      }

      return this.arbitrate(tx, batch, lot, input.amount, now, {
        userId,
        identityBindingId: null,
        team,
        identityStatus: 'ACTIVE'
      }, {
        source: 'MINIPROGRAM',
        inboundMessageId: null,
        idempotencyKey,
        wechatMessageId: null,
        wechatSortKey: null,
        wechatSentAt: null,
        submittedAt: now,
        receivedAt: now
      });
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async arbitrate(
    tx: Prisma.TransactionClient,
    batch: PlayerAuctionBatch,
    lot: PlayerAuctionLot,
    amount: number,
    now: Date,
    identity: ArbitrationIdentity,
    metadata: ArbitrationMetadata
  ) {
    let result: PlayerAuctionBidResult = 'VALID';
    let rejectionReason: string | null = null;
    const teamInLeague = identity.team?.leagueId === batch.leagueId ? identity.team : null;

    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      result = 'OVERFLOW';
      rejectionReason = '出价必须是有效的正整数';
    } else if (identity.identityStatus !== 'ACTIVE') {
      result = 'UNBOUND';
      rejectionReason = identity.identityStatus === 'INACTIVE' ? '用户已停用' : '微信身份尚未绑定';
    } else if (!teamInLeague) {
      result = identity.team ? 'WRONG_LEAGUE' : 'NO_ACTIVE_TEAM';
      rejectionReason = identity.team ? '球队不属于当前联赛' : '没有当前联赛的有效球队';
    } else if (lot.startedAt && metadata.submittedAt.getTime() < lot.startedAt.getTime()) {
      result = 'INACTIVE';
      rejectionReason = '出价早于当前拍卖时段';
    } else if (batch.status === 'RECOVERY_REQUIRED') {
      const detectedAt = batch.recoveryDetectedAt?.getTime();
      const originalDeadline = detectedAt === undefined
        ? undefined
        : detectedAt + (lot.pausedRemainingMs ?? 0);
      if (
        metadata.source !== 'WECHAT_GROUP' ||
        detectedAt === undefined ||
        metadata.submittedAt.getTime() > detectedAt ||
        metadata.submittedAt.getTime() >= (originalDeadline ?? 0)
      ) {
        result = 'RECOVERY_REQUIRED';
        rejectionReason = '拍卖正在等待恢复';
      }
    } else if (batch.status === 'PAUSED' || lot.status === 'PAUSED') {
      result = 'PAUSED';
      rejectionReason = '拍卖已暂停';
    } else if (batch.status !== 'ACTIVE' || lot.status !== 'ACTIVE') {
      result = 'INACTIVE';
      rejectionReason = '拍卖未进行';
    } else if (!lot.deadlineAt || metadata.submittedAt.getTime() >= lot.deadlineAt.getTime()) {
      result = 'DEADLINE_PASSED';
      rejectionReason = '出价已超过截止时间';
    }

    const bid = await tx.playerAuctionBid.create({
      data: {
        lotId: lot.id,
        inboundMessageId: metadata.inboundMessageId,
        leagueTeamId: teamInLeague?.id ?? null,
        userId: identity.userId,
        identityBindingId: identity.identityBindingId,
        source: metadata.source,
        idempotencyKey: metadata.idempotencyKey,
        amount: Number.isSafeInteger(amount) && amount > 0 ? Math.min(amount, MAX_AMOUNT) : 1,
        result,
        rejectionReason,
        wechatMessageId: metadata.wechatMessageId,
        wechatSortKey: metadata.wechatSortKey,
        wechatSentAt: metadata.wechatSentAt,
        submittedAt: metadata.submittedAt,
        receivedAt: metadata.receivedAt,
        becameHighestAt: result === 'VALID' ? metadata.submittedAt : null
      }
    });

    const monetaryResults: PlayerAuctionBidResult[] = [
      'VALID',
      'BELOW_STARTING_PRICE',
      'BELOW_MINIMUM_INCREMENT'
    ];
    let requiredMinimum: number | undefined;
    if (monetaryResults.includes(result)) {
      const orderBy: Prisma.PlayerAuctionBidOrderByWithRelationInput[] = metadata.source === 'WECHAT_GROUP'
        ? [
            { submittedAt: 'asc' },
            { wechatSortKey: 'asc' },
            { wechatMessageId: 'asc' },
            { id: 'asc' }
          ]
        : [{ submittedAt: 'asc' }, { id: 'asc' }];
      const ordered = await tx.playerAuctionBid.findMany({
        where: { lotId: lot.id, source: metadata.source, result: { in: monetaryResults } },
        orderBy
      });
      let currentPrice: number | null = null;
      let highestBidId: string | null = null;
      for (const candidate of ordered) {
        const minimum = currentPrice === null ? lot.startingPrice : currentPrice + lot.minimumIncrement;
        const nextResult: PlayerAuctionBidResult = candidate.amount < minimum
          ? currentPrice === null
            ? 'BELOW_STARTING_PRICE'
            : 'BELOW_MINIMUM_INCREMENT'
          : 'VALID';
        await tx.playerAuctionBid.update({
          where: { id: candidate.id },
          data: {
            result: nextResult,
            rejectionReason: nextResult === 'VALID'
              ? null
              : nextResult === 'BELOW_STARTING_PRICE'
                ? '出价低于起拍价'
                : '出价未达到最低加价幅度',
            becameHighestAt: nextResult === 'VALID' ? candidate.submittedAt : null
          }
        });
        if (candidate.id === bid.id) {
          result = nextResult;
          rejectionReason = nextResult === 'VALID'
            ? null
            : nextResult === 'BELOW_STARTING_PRICE'
              ? '出价低于起拍价'
              : '出价未达到最低加价幅度';
          if (nextResult !== 'VALID') requiredMinimum = minimum;
        }
        if (nextResult === 'VALID') {
          currentPrice = candidate.amount;
          highestBidId = candidate.id;
        }
      }
      const replayingRecovery = batch.status === 'RECOVERY_REQUIRED';
      const deadlineAt = result === 'VALID' && !replayingRecovery
        ? new Date(now.getTime() + 30_000)
        : null;
      await tx.playerAuctionLot.update({
        where: { id: lot.id },
        data: {
          currentPrice,
          currentHighestBidId: highestBidId,
          ...(deadlineAt
            ? { deadlineAt, deadlineEpoch: { increment: 1 }, lastCountdownMark: 30 }
            : {}),
          version: { increment: 1 }
        }
      });
      return {
        ...bid,
        result,
        rejectionReason,
        teamName: teamInLeague?.name ?? null,
        deadlineAt,
        requiredMinimum
      };
    }

    return {
      ...bid,
      result,
      rejectionReason,
      teamName: teamInLeague?.name ?? null,
      requiredMinimum
    };
  }
}
