import { createHmac, randomInt } from 'node:crypto';
import { ConflictException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { WECHAT_BOT_CONFIG } from './wechat-bot.config.js';
import type { WechatBotRuntimeConfig } from './wechat-bot.config.js';

const CODE_TTL_MS = 5 * 60 * 1_000;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1_000;
const MAX_INVALID_ATTEMPTS = 5;

@Injectable()
export class WechatBindingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WECHAT_BOT_CONFIG) private readonly config: WechatBotRuntimeConfig
  ) {}

  async issue(userId: string) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    const codeHash = this.hashCode(code);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.wechatBindingCode.updateMany({
        where: { userId, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
        data: { invalidatedAt: now }
      });
      await transaction.wechatBindingCode.create({ data: { userId, codeHash, expiresAt } });
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async status(userId: string) {
    const binding = await this.prisma.wechatIdentityBinding.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { boundAt: 'desc' },
      include: { device: { select: { name: true } } }
    });
    if (!binding) return { status: 'UNBOUND' as const };
    return {
      status: 'BOUND' as const,
      deviceName: binding.device.name,
      boundAt: binding.boundAt.toISOString()
    };
  }

  async unbind(userId: string) {
    const now = new Date();
    await this.prisma.wechatIdentityBinding.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'DISABLED', unboundAt: now, revokedReason: 'USER_UNBOUND' }
    });
    return { status: 'UNBOUND' as const };
  }

  async consume(deviceId: string, senderId: string, code: string, inboundId: string) {
    const recentFailures = await this.prisma.wechatInboundMessage.count({
      where: {
        deviceId,
        senderId,
        resultCode: 'BINDING_CODE_INVALID',
        receivedAt: { gte: new Date(Date.now() - ATTEMPT_WINDOW_MS) }
      }
    });
    if (recentFailures >= MAX_INVALID_ATTEMPTS) {
      throw new HttpException(
        { code: 'BINDING_RATE_LIMITED', message: '绑定尝试过于频繁，请稍后再试' },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const codeRow = await this.prisma.wechatBindingCode.findUnique({
      where: { codeHash: this.hashCode(code) }
    });
    if (!codeRow || codeRow.invalidatedAt || codeRow.expiresAt <= new Date()) {
      await this.prisma.wechatInboundMessage.update({
        where: { id: inboundId },
        data: { resultCode: 'BINDING_CODE_INVALID' }
      });
      throw new ConflictException({ code: 'BINDING_CODE_INVALID', message: '验证码无效或已过期' });
    }
    if (codeRow.consumedAt) {
      if (codeRow.consumedByInboundId === inboundId) {
        return this.prisma.wechatIdentityBinding.findFirstOrThrow({
          where: { deviceId, userId: codeRow.userId, status: 'ACTIVE' }
        });
      }
      throw new ConflictException({ code: 'BINDING_CODE_USED', message: '验证码已被使用' });
    }

    return this.prisma.$transaction(async (transaction) => {

      const [contactBinding, userBinding] = await Promise.all([
        transaction.wechatIdentityBinding.findUnique({
          where: { deviceId_wechatContactId: { deviceId, wechatContactId: senderId } }
        }),
        transaction.wechatIdentityBinding.findUnique({
          where: { deviceId_userId: { deviceId, userId: codeRow.userId } }
        })
      ]);
      if (contactBinding?.status === 'ACTIVE' && contactBinding.userId !== codeRow.userId) {
        throw new ConflictException({ code: 'WECHAT_IDENTITY_ALREADY_BOUND', message: '该微信身份已绑定其他用户' });
      }
      if (userBinding?.status === 'ACTIVE' && userBinding.wechatContactId !== senderId) {
        throw new ConflictException({ code: 'USER_ALREADY_BOUND', message: '该用户已绑定其他微信身份' });
      }

      const claimed = await transaction.wechatBindingCode.updateMany({
        where: { id: codeRow.id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: new Date() } },
        data: {
          consumedAt: new Date(),
          consumedByDeviceId: deviceId,
          consumedByContactId: senderId,
          consumedByInboundId: inboundId
        }
      });
      if (claimed.count !== 1) {
        throw new ConflictException({ code: 'BINDING_CODE_USED', message: '验证码已被使用' });
      }

      let binding;
      if (contactBinding && userBinding && contactBinding.id !== userBinding.id) {
        await transaction.wechatIdentityBinding.delete({ where: { id: contactBinding.id } });
        binding = await transaction.wechatIdentityBinding.update({
          where: { id: userBinding.id },
          data: { wechatContactId: senderId, status: 'ACTIVE', boundAt: new Date(), unboundAt: null, revokedReason: null }
        });
      } else if (contactBinding ?? userBinding) {
        const existing = contactBinding ?? userBinding!;
        binding = await transaction.wechatIdentityBinding.update({
          where: { id: existing.id },
          data: {
            userId: codeRow.userId,
            wechatContactId: senderId,
            status: 'ACTIVE',
            boundAt: new Date(),
            unboundAt: null,
            revokedReason: null
          }
        });
      } else {
        binding = await transaction.wechatIdentityBinding.create({
          data: { deviceId, wechatContactId: senderId, userId: codeRow.userId }
        });
      }
      await transaction.wechatInboundMessage.update({
        where: { id: inboundId },
        data: { resultCode: 'BINDING_SUCCEEDED' }
      });
      return binding;
    });
  }

  private hashCode(code: string): string {
    return createHmac('sha256', this.config.bindingCodePepper).update(code).digest('hex');
  }
}
