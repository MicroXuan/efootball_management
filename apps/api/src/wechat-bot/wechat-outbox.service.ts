import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WechatConversationType, WechatOutboxAck, WechatOutboxClaimResponse } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { WECHAT_BOT_CONFIG } from './wechat-bot.config.js';
import type { WechatBotRuntimeConfig } from './wechat-bot.config.js';

export type EnqueueWechatMessageInput = {
  deviceId: string;
  targetType: WechatConversationType;
  targetId: string;
  businessKey: string;
  text: string;
  priority?: number;
  scheduledAt?: Date;
};

@Injectable()
export class WechatOutboxService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WECHAT_BOT_CONFIG) private readonly config: WechatBotRuntimeConfig
  ) {}

  async enqueue(input: EnqueueWechatMessageInput) {
    try {
      return await this.prisma.wechatOutboxMessage.create({
        data: {
          deviceId: input.deviceId,
          targetType: input.targetType,
          targetId: input.targetId,
          businessKey: input.businessKey,
          text: input.text,
          priority: input.priority ?? 100,
          scheduledAt: input.scheduledAt ?? new Date()
        }
      });
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')) throw error;
      return this.prisma.wechatOutboxMessage.findUniqueOrThrow({ where: { businessKey: input.businessKey } });
    }
  }

  async claim(deviceId: string, limit: number): Promise<WechatOutboxClaimResponse> {
    const device = await this.prisma.wechatBotDevice.findUnique({
      where: { id: deviceId },
      select: { status: true, circuitStatus: true }
    });
    if (!device || device.status !== 'ACTIVE' || device.circuitStatus === 'OPEN') return { messages: [] };

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.config.outboxLeaseMs);
    const leaseOwner = `${deviceId}:${randomUUID()}`;
    return this.prisma.$transaction(async (transaction) => {
      await transaction.wechatOutboxMessage.updateMany({
        where: { deviceId, status: 'LEASED', leaseExpiresAt: { lte: now } },
        data: { status: 'PENDING', leaseOwner: null, leaseExpiresAt: null }
      });
      const candidates = await transaction.wechatOutboxMessage.findMany({
        where: { deviceId, status: 'PENDING', scheduledAt: { lte: now } },
        orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }, { id: 'asc' }],
        take: limit
      });
      const claimed = [];
      for (const candidate of candidates) {
        const updated = await transaction.wechatOutboxMessage.updateMany({
          where: { id: candidate.id, status: 'PENDING' },
          data: { status: 'LEASED', leaseOwner, leaseExpiresAt }
        });
        if (updated.count === 1) claimed.push(candidate);
      }
      return {
        messages: claimed.map((message) => ({
          id: message.id,
          targetType: message.targetType,
          targetId: message.targetId,
          text: message.text,
          priority: message.priority,
          scheduledAt: message.scheduledAt.toISOString()
        }))
      };
    });
  }

  async ack(deviceId: string, messageId: string, input: WechatOutboxAck) {
    const message = await this.prisma.wechatOutboxMessage.findUnique({ where: { id: messageId } });
    if (!message || message.deviceId !== deviceId) {
      throw new NotFoundException({ code: 'WECHAT_OUTBOX_NOT_FOUND', message: 'Outbox message not found' });
    }
    if (input.status === 'SENT') {
      if (!input.readbackMessageId) {
        throw new BadRequestException({ code: 'WECHAT_READBACK_REQUIRED', message: 'A read-back message id is required' });
      }
      return this.prisma.wechatOutboxMessage.update({
        where: { id: message.id },
        data: {
          status: 'SENT',
          readbackMessageId: input.readbackMessageId,
          sentAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          failureCode: null,
          failureMessage: null
        }
      });
    }

    if (input.status === 'AMBIGUOUS') {
      const [updated] = await this.prisma.$transaction([
        this.prisma.wechatOutboxMessage.update({
          where: { id: message.id },
          data: {
            status: 'FAILED',
            attemptCount: message.attemptCount + 1,
            failureCode: input.errorCode,
            failureMessage: input.errorMessage,
            leaseOwner: null,
            leaseExpiresAt: null
          }
        }),
        this.prisma.wechatBotDevice.update({
          where: { id: deviceId },
          data: {
            circuitStatus: 'OPEN',
            circuitReason: `${input.errorCode}: ${input.errorMessage}`.slice(0, 512),
            circuitOpenedAt: new Date()
          }
        })
      ]);
      return updated;
    }

    const attemptCount = message.attemptCount + 1;
    if (attemptCount >= this.config.outboxMaxAttempts) {
      const [updated] = await this.prisma.$transaction([
        this.prisma.wechatOutboxMessage.update({
          where: { id: message.id },
          data: {
            status: 'FAILED',
            attemptCount,
            failureCode: input.errorCode,
            failureMessage: input.errorMessage,
            leaseOwner: null,
            leaseExpiresAt: null
          }
        }),
        this.prisma.wechatBotDevice.update({
          where: { id: deviceId },
          data: {
            circuitStatus: 'OPEN',
            circuitReason: `${input.errorCode}: ${input.errorMessage}`.slice(0, 512),
            circuitOpenedAt: new Date()
          }
        })
      ]);
      return updated;
    }

    return this.prisma.wechatOutboxMessage.update({
      where: { id: message.id },
      data: {
        status: 'PENDING',
        attemptCount,
        failureCode: input.errorCode,
        failureMessage: input.errorMessage,
        scheduledAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** (attemptCount - 1))),
        leaseOwner: null,
        leaseExpiresAt: null
      }
    });
  }
}
