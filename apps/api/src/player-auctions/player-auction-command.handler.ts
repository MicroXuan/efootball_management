import { HttpException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { WechatOutboxService } from '../wechat-bot/wechat-outbox.service.js';
import { PlayerAuctionBidService } from './player-auction-bid.service.js';
import { PlayerAuctionMessageFormatter } from './player-auction-message.formatter.js';
import { PlayerAuctionRecoveryService } from './player-auction-recovery.service.js';
import { PlayerAuctionStateService } from './player-auction-state.service.js';

const MANAGER_COMMANDS = new Set(['开始拍卖', '暂停拍卖', '继续拍卖', '下一位', '取消拍卖']);
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
        text = result.result === 'VALID'
          ? this.formatter.validBid(result.teamName ?? '未知球队', result.amount)
          : this.formatter.invalidBid(result.result, result.result === 'BELOW_MINIMUM_INCREMENT' ? result.amount : undefined);
      } else {
        const identity = await this.prisma.wechatIdentityBinding.findUnique({
          where: { deviceId_wechatContactId: { deviceId: inbound.deviceId, wechatContactId: inbound.senderId } }
        });
        if (!identity || identity.status !== 'ACTIVE') {
          text = '请先在小程序获取验证码并完成微信身份绑定。';
        } else {
          const transition = command === '开始拍卖'
            ? await this.state.start(inbound.groupBindingId, identity.userId)
            : command === '暂停拍卖'
              ? await this.state.pause(inbound.groupBindingId, identity.userId)
              : command === '继续拍卖'
                ? await this.state.resume(inbound.groupBindingId, identity.userId)
                : command === '下一位'
                  ? await this.state.next(inbound.groupBindingId, identity.userId)
                  : await this.state.cancel(inbound.groupBindingId, identity.userId);
          text = transition.transition === 'COMPLETED'
            ? this.formatter.completed()
            : transition.transition === 'PAUSED'
              ? '拍卖已由管理员暂停。'
              : transition.transition === 'CANCELLED'
                ? '本批次拍卖已由管理员取消。'
                : transition.transition === 'RESUMED'
                  ? '拍卖已继续，保留暂停时的剩余倒计时。'
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
}
