import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { WechatBridgeHeartbeat, WechatInboundBatch, WechatInboundBatchResult } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { WechatCommandRouterService } from './wechat-command-router.service.js';
import { PLAYER_AUCTION_RECOVERY_HOOK, type PlayerAuctionRecoveryHook } from '../player-auctions/player-auction-recovery.hook.js';

const GROUP_COMMAND = /^(?:帮助|查询赛程|我的赛程|开始拍卖|暂停拍卖|继续拍卖|取消拍卖|\d+)$/;
const PRIVATE_BINDING_COMMAND = /^绑定\s+\d{6}$/;

@Injectable()
export class WechatBridgeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(WechatCommandRouterService) private readonly router?: WechatCommandRouterService,
    @Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef
  ) {}

  async heartbeat(deviceId: string, input: WechatBridgeHeartbeat) {
    const now = new Date();
    await this.prisma.wechatBotDevice.update({
      where: { id: deviceId },
      data: {
        ...(input.wechatAccountId !== undefined ? { wechatAccountId: input.wechatAccountId } : {}),
        wechatVersion: input.wechatVersion,
        loginStatus: input.loginStatus,
        ...(input.listenerWatermark !== undefined ? { listenerWatermark: input.listenerWatermark } : {}),
        screenLocked: input.screenLocked,
        outboundQueueDepth: input.outboundQueueDepth,
        lastHeartbeatAt: now
      }
    });
    const recovery = this.moduleRef?.get<PlayerAuctionRecoveryHook>(PLAYER_AUCTION_RECOVERY_HOOK, { strict: false });
    if (input.loginStatus !== 'LOGGED_IN' || input.screenLocked) {
      await recovery?.onBridgeUnavailable(deviceId, input.screenLocked ? 'WINDOW_SESSION_LOCKED' : 'WECHAT_NOT_LOGGED_IN');
    } else {
      recovery?.bridgeAvailable(deviceId);
    }
    await Promise.all(input.observedGroups.map((group) => this.prisma.wechatObservedGroup.upsert({
      where: { deviceId_wechatGroupId: { deviceId, wechatGroupId: group.wechatGroupId } },
      create: {
        deviceId,
        wechatGroupId: group.wechatGroupId,
        displayName: group.displayName,
        firstObservedAt: now,
        lastObservedAt: now
      },
      update: { displayName: group.displayName, lastObservedAt: now }
    })));
    const enabledGroups = await this.prisma.wechatGroupBinding.findMany({
      where: { deviceId, enabled: true },
      select: { wechatGroupId: true, displayName: true },
      orderBy: [{ wechatGroupId: 'asc' }]
    });
    return { acceptedAt: now.toISOString(), enabledGroups };
  }

  async acceptBatch(deviceId: string, input: WechatInboundBatch): Promise<WechatInboundBatchResult> {
    const results: WechatInboundBatchResult['results'] = [];
    for (const message of input.messages) {
      const duplicate = await this.prisma.wechatInboundMessage.findUnique({
        where: { deviceId_messageId: { deviceId, messageId: message.messageId } }
      });
      if (duplicate) {
        if (duplicate.processingStatus === 'PENDING') await this.router?.route(duplicate.id);
        const resumed = duplicate.processingStatus === 'PENDING'
          ? await this.prisma.wechatInboundMessage.findUnique({ where: { id: duplicate.id } })
          : duplicate;
        results.push({
          messageId: message.messageId,
          status: 'DUPLICATE',
          inboundId: duplicate.id,
          resultCode: resumed?.resultCode ?? duplicate.resultCode
        });
        continue;
      }

      const commandText = message.text.trim();
      let groupBindingId: string | null = null;
      if (message.conversationType === 'GROUP') {
        const binding = await this.prisma.wechatGroupBinding.findUnique({
          where: { deviceId_wechatGroupId: { deviceId, wechatGroupId: message.conversationId } },
          select: { id: true, enabled: true }
        });
        if (!binding?.enabled || !GROUP_COMMAND.test(commandText)) {
          results.push({ messageId: message.messageId, status: 'IGNORED', inboundId: null, resultCode: 'IGNORED' });
          continue;
        }
        groupBindingId = binding.id;
      } else if (!PRIVATE_BINDING_COMMAND.test(commandText)) {
        results.push({ messageId: message.messageId, status: 'IGNORED', inboundId: null, resultCode: 'IGNORED' });
        continue;
      }

      try {
        const row = await this.prisma.wechatInboundMessage.create({
          data: {
            deviceId,
            messageId: message.messageId,
            conversationType: message.conversationType,
            conversationId: message.conversationId,
            senderId: message.senderId,
            groupBindingId,
            wechatSentAt: new Date(message.sentAt),
            ...(message.sequence !== undefined ? { sequence: message.sequence } : {}),
            messageType: message.messageType,
            commandText
          }
        });
        await this.router?.route(row.id);
        results.push({ messageId: message.messageId, status: 'ACCEPTED', inboundId: row.id, resultCode: null });
      } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')) throw error;
        const row = await this.prisma.wechatInboundMessage.findUniqueOrThrow({
          where: { deviceId_messageId: { deviceId, messageId: message.messageId } }
        });
        results.push({ messageId: message.messageId, status: 'DUPLICATE', inboundId: row.id, resultCode: row.resultCode });
      }
    }
    return { results };
  }
}
