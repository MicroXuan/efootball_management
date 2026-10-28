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
        text = '拍卖管理仅限管理员私聊机器人，请私聊发送“帮助”。';
      }
    } catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      text = typeof response === 'object' && response !== null && 'code' in response && response.code === 'AUCTION_CHANNEL_MISMATCH'
        ? '本批次请点击小程序拍卖大厅出价。'
        : typeof response === 'object' && response !== null && 'message' in response
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
