import { HttpException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { WechatBindingService } from './wechat-binding.service.js';
import { WECHAT_HELP_TEXT } from './wechat-message-formatter.js';
import { WechatOutboxService } from './wechat-outbox.service.js';
import { WechatScheduleQueryService } from './wechat-schedule-query.service.js';

const PRIVATE_BINDING_COMMAND = /^绑定\s+(\d{6})$/;

@Injectable()
export class WechatCommandRouterService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WechatBindingService) private readonly bindings: WechatBindingService,
    @Inject(WechatScheduleQueryService) private readonly schedules: WechatScheduleQueryService,
    @Inject(WechatOutboxService) private readonly outbox: WechatOutboxService
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

    if (inbound.commandText === '帮助') {
      await this.reply(inbound, [WECHAT_HELP_TEXT]);
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
