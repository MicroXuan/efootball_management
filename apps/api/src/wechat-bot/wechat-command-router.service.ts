import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service.js';
import { WechatBindingService } from './wechat-binding.service.js';
import { formatWechatHelp } from './wechat-message-formatter.js';
import { WechatOutboxService } from './wechat-outbox.service.js';
import { WechatScheduleQueryService } from './wechat-schedule-query.service.js';
import { PLAYER_AUCTION_COMMAND_HANDLER, type PlayerAuctionCommandHook } from '../player-auctions/player-auction-command.hook.js';

const PRIVATE_BINDING_COMMAND = /^绑定\s+(\d{6})$/;
const PURE_INTEGER = /^\d+$/;
const AUCTION_MANAGER_COMMANDS = new Set(['开始拍卖', '暂停拍卖', '继续拍卖', '取消拍卖']);
const SCHEDULE_COMMANDS = new Set(['查询赛程', '我的赛程']);

@Injectable()
export class WechatCommandRouterService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WechatBindingService) private readonly bindings: WechatBindingService,
    @Inject(WechatScheduleQueryService) private readonly schedules: WechatScheduleQueryService,
    @Inject(WechatOutboxService) private readonly outbox: WechatOutboxService,
    @Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef
  ) {}

  async route(inboundId: string): Promise<void> {
    const inbound = await this.prisma.wechatInboundMessage.findUnique({ where: { id: inboundId } });
    if (!inbound || inbound.processingStatus !== 'PENDING' || !inbound.commandText) return;

    if (inbound.conversationType === 'PRIVATE') {
      await this.routePrivateBinding(inbound);
      return;
    }

    if (!inbound.groupBindingId) {
      await this.finish(inbound.id, 'IGNORED', 'GROUP_NOT_BOUND');
      return;
    }

    const binding = await this.prisma.wechatGroupBinding.findFirst({
      where: { id: inbound.groupBindingId, enabled: true },
      select: { capabilities: { select: { capability: true } } }
    });
    if (!binding) {
      await this.finish(inbound.id, 'IGNORED', 'GROUP_NOT_BOUND');
      return;
    }
    const capabilities = binding.capabilities.map((item) => item.capability);
    const hasSchedule = capabilities.includes('SCHEDULE_QUERY');
    const hasAuction = capabilities.includes('PLAYER_AUCTION');
    const isAuctionCommand = PURE_INTEGER.test(inbound.commandText) || AUCTION_MANAGER_COMMANDS.has(inbound.commandText);
    const isScheduleCommand = SCHEDULE_COMMANDS.has(inbound.commandText);

    if (isAuctionCommand) {
      if (!hasAuction) {
        await this.finish(inbound.id, 'IGNORED', 'AUCTION_CAPABILITY_DISABLED');
        return;
      }
      const auction = this.moduleRef?.get<PlayerAuctionCommandHook>(PLAYER_AUCTION_COMMAND_HANDLER, { strict: false });
      if (auction && await auction.handle(inbound.id)) {
        await this.finish(inbound.id, 'PROCESSED', 'AUCTION_HANDLED');
        return;
      }
    }

    if (isScheduleCommand && !hasSchedule) {
      await this.finish(inbound.id, 'IGNORED', 'SCHEDULE_CAPABILITY_DISABLED');
      return;
    }

    if (inbound.commandText === '帮助') {
      await this.reply(inbound, [formatWechatHelp(capabilities)]);
      await this.finish(inbound.id, 'PROCESSED', 'HELP_REPLIED');
      return;
    }
    if (inbound.commandText === '查询赛程') {
      await this.reply(inbound, await this.schedules.query(inbound.groupBindingId));
      await this.finish(inbound.id, 'PROCESSED', 'SCHEDULE_REPLIED');
      return;
    }
    if (inbound.commandText === '我的赛程') {
      const identity = await this.prisma.wechatIdentityBinding.findUnique({
        where: {
          deviceId_wechatContactId: {
            deviceId: inbound.deviceId,
            wechatContactId: inbound.senderId
          }
        },
        select: { userId: true, status: true }
      });
      if (!identity || identity.status !== 'ACTIVE') {
        await this.reply(inbound, ['请先在小程序获取验证码，再私聊机器人发送：绑定 123456']);
        await this.finish(inbound.id, 'PROCESSED', 'IDENTITY_BINDING_REQUIRED');
        return;
      }
      await this.reply(inbound, await this.schedules.query(inbound.groupBindingId, identity.userId));
      await this.finish(inbound.id, 'PROCESSED', 'MY_SCHEDULE_REPLIED');
      return;
    }

    await this.finish(inbound.id, 'IGNORED', 'COMMAND_IGNORED');
  }

  private async routePrivateBinding(inbound: {
    id: string;
    deviceId: string;
    conversationType: 'GROUP' | 'PRIVATE';
    conversationId: string;
    senderId: string;
    commandText: string | null;
  }): Promise<void> {
    const matched = PRIVATE_BINDING_COMMAND.exec(inbound.commandText ?? '');
    if (!matched?.[1]) {
      await this.finish(inbound.id, 'IGNORED', 'COMMAND_IGNORED');
      return;
    }
    try {
      await this.bindings.consume(inbound.deviceId, inbound.senderId, matched[1], inbound.id);
      await this.reply(inbound, ['绑定成功。']);
      await this.finish(inbound.id, 'PROCESSED', 'BINDING_SUCCEEDED');
    } catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      const message = typeof response === 'object' && response !== null && 'message' in response
        ? String(response.message)
        : '绑定失败，请稍后重试。';
      const code = typeof response === 'object' && response !== null && 'code' in response
        ? String(response.code)
        : 'BINDING_FAILED';
      await this.reply(inbound, [message]);
      await this.finish(inbound.id, 'PROCESSED', code);
    }
  }

  private async reply(
    inbound: {
      id: string;
      deviceId: string;
      conversationType: 'GROUP' | 'PRIVATE';
      conversationId: string;
    },
    pages: string[]
  ): Promise<void> {
    for (let index = 0; index < pages.length; index += 1) {
      await this.outbox.enqueue({
        deviceId: inbound.deviceId,
        targetType: inbound.conversationType,
        targetId: inbound.conversationId,
        businessKey: `inbound:${inbound.id}:reply:${index + 1}`,
        text: pages[index]!
      });
    }
  }

  private async finish(
    inboundId: string,
    processingStatus: 'PROCESSED' | 'IGNORED' | 'FAILED',
    resultCode: string
  ): Promise<void> {
    await this.prisma.wechatInboundMessage.update({
      where: { id: inboundId },
      data: { processingStatus, resultCode, processedAt: new Date() }
    });
  }
}
