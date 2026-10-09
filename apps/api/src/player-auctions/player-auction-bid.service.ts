import { Inject, Injectable } from '@nestjs/common';
import type { PlayerAuctionBidResult } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerAuctionError } from './player-auction.errors.js';
import { PlayerAuctionLockRepository } from './player-auction-lock.repository.js';

const MAX_AMOUNT = 2_147_483_647;

@Injectable()
export class PlayerAuctionBidService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAuctionLockRepository) private readonly locks: PlayerAuctionLockRepository
  ) {}

  placeBid(inboundMessageId: string, amount: number) {
    return this.prisma.$transaction(async (tx) => {
      const inbound = await tx.wechatInboundMessage.findUnique({
        where: { id: inboundMessageId }, include: { groupBinding: { select: { id: true, leagueId: true } } }
      });
      if (!inbound?.groupBindingId || !inbound.groupBinding) throw new PlayerAuctionError('AUCTION_GROUP_INVALID', '消息不属于已绑定的微信群', 409);
      const duplicate = await tx.playerAuctionBid.findUnique({ where: { inboundMessageId } });
      if (duplicate) return { ...duplicate, result: 'DUPLICATE' as const };
      await this.locks.lockGroup(tx, inbound.groupBindingId);
      const batch = await tx.playerAuctionBatch.findFirst({
        where: { groupBindingId: inbound.groupBindingId, status: { in: ['ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      });
      if (!batch?.currentLotId) throw new PlayerAuctionError('AUCTION_INACTIVE', '当前没有进行中的拍卖', 409);
      await this.locks.lockBatch(tx, batch.id);
      await this.locks.lockLot(tx, batch.currentLotId);
      const lot = await tx.playerAuctionLot.findUnique({ where: { id: batch.currentLotId } });
      if (!lot) throw new PlayerAuctionError('AUCTION_INACTIVE', '当前没有进行中的拍卖', 409);
      const now = await this.locks.now(tx);
      const identity = await tx.wechatIdentityBinding.findFirst({
        where: { deviceId: inbound.deviceId, wechatContactId: inbound.senderId, status: 'ACTIVE' }
      });
      let team = identity ? await tx.leagueTeam.findFirst({ where: { ownerUserId: identity.userId, leagueId: batch.leagueId, status: 'ACTIVE' } }) : null;
      let result: PlayerAuctionBidResult = 'VALID';
      let rejectionReason: string | null = null;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
        result = 'OVERFLOW'; rejectionReason = '出价必须是有效的正整数';
      } else if (!identity) {
        result = 'UNBOUND'; rejectionReason = '微信身份尚未绑定';
      } else if (!team) {
        const other = await tx.leagueTeam.findFirst({ where: { ownerUserId: identity.userId, status: 'ACTIVE' } });
        result = other ? 'WRONG_LEAGUE' : 'NO_ACTIVE_TEAM';
        rejectionReason = other ? '球队不属于当前联赛' : '没有当前联赛的有效球队';
        team = other;
      } else if (batch.status === 'RECOVERY_REQUIRED') {
        result = 'RECOVERY_REQUIRED'; rejectionReason = '拍卖正在等待恢复';
      } else if (batch.status === 'PAUSED' || lot.status === 'PAUSED') {
        result = 'PAUSED'; rejectionReason = '拍卖已暂停';
      } else if (batch.status !== 'ACTIVE' || lot.status !== 'ACTIVE') {
        result = 'INACTIVE'; rejectionReason = '拍卖未进行';
      } else if (!lot.deadlineAt || inbound.wechatSentAt.getTime() >= lot.deadlineAt.getTime()) {
        result = 'DEADLINE_PASSED'; rejectionReason = '出价已超过截止时间';
      } else if (lot.currentPrice === null && amount < lot.startingPrice) {
        result = 'BELOW_STARTING_PRICE'; rejectionReason = '出价低于起拍价';
      } else if (lot.currentPrice !== null && amount < lot.currentPrice + lot.minimumIncrement) {
        result = 'BELOW_MINIMUM_INCREMENT'; rejectionReason = '出价未达到最低加价幅度';
      }
      const bid = await tx.playerAuctionBid.create({
        data: {
          lotId: lot.id, inboundMessageId, leagueTeamId: team?.leagueId === batch.leagueId ? team.id : null,
          userId: identity?.userId ?? null, identityBindingId: identity?.id ?? null,
          amount: Number.isSafeInteger(amount) && amount > 0 ? Math.min(amount, MAX_AMOUNT) : 1,
          result, rejectionReason, wechatMessageId: inbound.messageId,
          wechatSortKey: inbound.sequence ?? inbound.messageId, wechatSentAt: inbound.wechatSentAt,
          receivedAt: inbound.receivedAt, becameHighestAt: result === 'VALID' ? now : null
        }
      });
      if (result === 'VALID') {
        const deadlineAt = new Date(now.getTime() + 30_000);
        await tx.playerAuctionLot.update({
          where: { id: lot.id },
          data: { currentPrice: amount, currentHighestBidId: bid.id, deadlineAt, deadlineEpoch: { increment: 1 }, lastCountdownMark: 30, version: { increment: 1 } }
        });
        return { ...bid, teamName: team!.name, deadlineAt };
      }
      return { ...bid, teamName: team?.leagueId === batch.leagueId ? team.name : null };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
