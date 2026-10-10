import { HttpException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { WechatOutboxService } from '../wechat-bot/wechat-outbox.service.js';
import { PlayerAuctionBidService } from './player-auction-bid.service.js';
import { PlayerAuctionMessageFormatter } from './player-auction-message.formatter.js';
import { PlayerAuctionRecoveryService } from './player-auction-recovery.service.js';
import { PlayerAuctionStateService } from './player-auction-state.service.js';

const MANAGER_COMMANDS = new Set(['开始拍卖', '暂停拍卖', '继续拍卖', '取消拍卖']);
const PURE_INTEGER = /^\d+$/;

@Injectable()
export class PlayerAuctionCommandHandler {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAuctionStateService) private readonly state: PlayerAuctionStateService,
    @Inject(PlayerAuctionBidService) private readonly bids: PlayerAuctionBidService,
    @Inject(PlayerAuctionRecoveryService) private readonly recovery: PlayerAuctionRecoveryService,
    @Inject(WechatOutboxService) private readonly outbox: WechatOutboxService,
    @Inject(PlayerAuctionMessageFormatter) private readonly formatter: PlayerAuctionMessageFormatter
  ) {}

  async handle(inboundId: string) {
    const inbound = await this.prisma.wechatInboundMessage.findUnique({ where: { id: inboundId } });
    if (!inbound || inbound.conversationType !== 'GROUP' || !inbound.groupBindingId || !inbound.commandText) return false;
    const command = inbound.commandText.trim();
    if (!MANAGER_COMMANDS.has(command) && !PURE_INTEGER.test(command)) return false;
    let text: string;
    try {
      if (PURE_INTEGER.test(command)) {
        const result = await this.bids.placeBid(inbound.id, Number(command));
        const requiredMinimum = 'requiredMinimum' in result ? result.requiredMinimum : undefined;
        text = result.result === 'VALID'
          ? this.formatter.validBid(result.teamName ?? '未知球队', result.amount)
          : this.formatter.invalidBid(result.result, requiredMinimum);
      } else {
        const identity = await this.prisma.wechatIdentityBinding.findUnique({
          where: { deviceId_wechatContactId: { deviceId: inbound.deviceId, wechatContactId: inbound.senderId } }
        });
        if (!identity || identity.status !== 'ACTIVE') {
          text = '请先在小程序获取验证码并完成微信身份绑定。';
        } else {
          const activeBatch = command === '继续拍卖'
            ? await this.prisma.playerAuctionBatch.findFirst({
                where: { groupBindingId: inbound.groupBindingId, status: { in: ['PAUSED', 'RECOVERY_REQUIRED'] } },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
              })
            : null;
          const transition = command === '开始拍卖'
            ? await this.state.start(inbound.groupBindingId, identity.userId)
            : command === '暂停拍卖'
              ? await this.state.pause(inbound.groupBindingId, identity.userId)
              : command === '继续拍卖'
                ? activeBatch?.status === 'RECOVERY_REQUIRED'
                  ? await this.recovery.recover(activeBatch.id, identity.userId, false)
                  : await this.state.resume(inbound.groupBindingId, identity.userId)
                : await this.state.cancel(inbound.groupBindingId, identity.userId);
          text = transition.transition === 'PAUSED'
              ? '拍卖已由管理员暂停。'
              : transition.transition === 'CANCELLED'
                ? '本批次拍卖已由管理员取消。'
                : transition.transition === 'RECOVERED'
                  ? '拍卖已由管理员恢复，当前球员重新开始 30 秒倒计时。'
                : transition.transition === 'RESUMED'
                  ? '拍卖已继续，保留暂停时的剩余倒计时。'
                  : transition.lotId
                    ? await this.openingText(transition.batchId, transition.lotId, transition.transition === 'STARTED')
                    : '拍卖已开始，倒计时 30 秒。';
        }
      }
    } catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      text = typeof response === 'object' && response !== null && 'message' in response
        ? String(response.message)
        : '拍卖操作失败，请稍后重试。';
    }
    await this.outbox.enqueue({
      deviceId: inbound.deviceId,
      targetType: 'GROUP',
      targetId: inbound.conversationId,
      businessKey: `inbound:${inbound.id}:auction-reply`,
      text,
      priority: 500
    });
    return true;
  }

  private async openingText(batchId: string, lotId: string, includeQueue: boolean) {
    const [lot, lots] = await Promise.all([
      this.prisma.playerAuctionLot.findUnique({ where: { id: lotId } }),
      includeQueue
        ? this.prisma.playerAuctionLot.findMany({ where: { batchId }, orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] })
        : Promise.resolve([])
    ]);
    if (!lot) return '拍卖已开始，倒计时 30 秒。';
    const opening = this.formatter.opening({
      displayOrder: lot.displayOrder,
      playerName: lot.playerNameSnapshot,
      playerSnapshot: lot.playerSnapshot as Record<string, unknown>,
      startingPrice: lot.startingPrice,
      minimumIncrement: lot.minimumIncrement
    });
    return includeQueue
      ? `${this.formatter.queue(lots.map((item) => ({ displayOrder: item.displayOrder, playerName: item.playerNameSnapshot, startingPrice: item.startingPrice })))}\n\n${opening}`
      : opening;
  }
}
