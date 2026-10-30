import { normalizeWechatCommand, GROUP_COMMAND_CANDIDATE, PRIVATE_COMMAND_CANDIDATE } from './wechat-command-ux.js';
import { WECHAT_BOT_CONFIG, type WechatBotRuntimeConfig } from './wechat-bot.config.js';
import { ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { WechatBridgeHeartbeat, WechatInboundBatch, WechatInboundBatchResult } from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { WechatCommandRouterService } from './wechat-command-router.service.js';
import { PLAYER_AUCTION_RECOVERY_HOOK, type PlayerAuctionRecoveryHook } from '../player-auctions/player-auction-recovery.hook.js';

@Injectable()
export class WechatBridgeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(WechatCommandRouterService) private readonly router?: WechatCommandRouterService,
    @Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef,
    @Optional() @Inject(WECHAT_BOT_CONFIG) private readonly config?: WechatBotRuntimeConfig
  ) {}

  async heartbeat(deviceId: string, input: WechatBridgeHeartbeat) {
    const now = new Date();
    const changedAccount = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM wechat_bot_devices WHERE id = ${deviceId} FOR UPDATE`;
      const device = await tx.wechatBotDevice.findUniqueOrThrow({ where: { id: deviceId } });
      if (input.wechatAccountId && device.wechatAccountId && input.wechatAccountId !== device.wechatAccountId) {
        await tx.wechatIdentityBinding.updateMany({ where: { deviceId, status: 'ACTIVE' }, data: {
          status: 'DISABLED', version: { increment: 1 }, unboundAt: now, revokedReason: 'ROBOT_ACCOUNT_CHANGED'
        } });
        if (this.config?.privateManagementEnabled) {
          const contacts = await tx.wechatAdminContact.findMany({ where: { deviceId }, select: { id: true } });
          await tx.wechatAdminOperation.updateMany({ where: { contactId: { in: contacts.map((c) => c.id) }, status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: now } });
        }
        if (this.config?.privateScoreEnabled) {
          await tx.wechatScoreOperation.updateMany({ where: { contact: { deviceId }, status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: now } });
          await tx.wechatAdminContact.updateMany({ where: { deviceId }, data: {
            adminId: null, boundAt: null, leagueId: null, seasonId: null, version: { increment: 1 }
          } });
        }
        await tx.wechatBotDevice.update({ where: { id: deviceId }, data: { status: 'DISABLED', circuitStatus: 'OPEN', circuitReason: 'ROBOT_ACCOUNT_CHANGED', circuitOpenedAt: now } });
        return true;
      }
      await tx.wechatBotDevice.update({
        where: { id: deviceId },
        data: {
          ...(input.wechatAccountId ? { wechatAccountId: input.wechatAccountId } : {}),
          wechatVersion: input.wechatVersion,
          loginStatus: input.loginStatus,
          receiverHealth: input.receiverHealth ?? Prisma.DbNull,
          ...(input.listenerWatermark !== undefined ? { listenerWatermark: input.listenerWatermark } : {}),
          screenLocked: input.screenLocked,
          outboundQueueDepth: input.outboundQueueDepth,
          lastHeartbeatAt: now
        }
      });
      // Synchronize under the device lock, preserving bindings and history.
      if (input.observedGroupsComplete && input.loginStatus === 'LOGGED_IN') {
        await tx.wechatObservedGroup.updateMany({
          where: { deviceId, wechatGroupId: { notIn: input.observedGroups.map((group) => group.wechatGroupId) } },
          data: { available: false }
        });
      }
      await Promise.all(input.observedGroups.map((group) => tx.wechatObservedGroup.upsert({
        where: { deviceId_wechatGroupId: { deviceId, wechatGroupId: group.wechatGroupId } },
        create: {
          deviceId,
          available: true,
          wechatGroupId: group.wechatGroupId,
          displayName: group.displayName,
          firstObservedAt: now,
          lastObservedAt: now
        },
        update: { available: true, displayName: group.displayName, lastObservedAt: now }
      })));
      return false;
    });
    if (changedAccount) throw new ConflictException({ code: 'ROBOT_ACCOUNT_CHANGED', message: '机器人账号已变更，设备已停用，请为新账号配置新设备' });
    const recovery = this.moduleRef?.get<PlayerAuctionRecoveryHook>(PLAYER_AUCTION_RECOVERY_HOOK, { strict: false });
    if (input.loginStatus !== 'LOGGED_IN' || input.screenLocked) {
      await recovery?.onBridgeUnavailable(deviceId, input.screenLocked ? 'WINDOW_SESSION_LOCKED' : 'WECHAT_NOT_LOGGED_IN');
    } else {
      recovery?.bridgeAvailable(deviceId);
    }
    const enabledGroups = await this.prisma.wechatGroupBinding.findMany({
      where: { deviceId, enabled: true, observedGroup: { available: true } },
      select: { wechatGroupId: true, displayName: true },
      orderBy: [{ wechatGroupId: 'asc' }]
    });
    const privateContacts = this.config?.privateScoreEnabled ? await this.prisma.wechatInboundMessage.findMany({
      where: { deviceId, conversationType: 'PRIVATE', receivedAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
      select: { conversationId: true }, distinct: ['conversationId'], orderBy: { receivedAt: 'desc' }, take: 100
    }) : null;
    return { acceptedAt: now.toISOString(), enabledGroups,
      ...(privateContacts ? { privateReplyContactIds: privateContacts.map((c) => c.conversationId) } : {}) };

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

      const commandText = normalizeWechatCommand(message.text, message.conversationType === 'GROUP');
      let groupBindingId: string | null = null;
      if (message.conversationType === 'GROUP') {
        const binding = await this.prisma.wechatGroupBinding.findUnique({
          where: { deviceId_wechatGroupId: { deviceId, wechatGroupId: message.conversationId } },
          select: { id: true, enabled: true }
        });
        if (!binding?.enabled || !GROUP_COMMAND_CANDIDATE.test(commandText)) {
          results.push({ messageId: message.messageId, status: 'IGNORED', inboundId: null, resultCode: 'IGNORED' });
          continue;
        }
        groupBindingId = binding.id;
      } else if (message.conversationId !== message.senderId || !PRIVATE_COMMAND_CANDIDATE.test(commandText)) {
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
