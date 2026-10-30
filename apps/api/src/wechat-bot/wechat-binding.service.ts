import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { WECHAT_BOT_CONFIG, type WechatBotRuntimeConfig } from './wechat-bot.config.js';

@Injectable()
export class WechatBindingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WECHAT_BOT_CONFIG) readonly config: WechatBotRuntimeConfig
  ) {}

  // Keep old clients' routes callable, but never issue or consume a self-binding credential.
  async issue(userId: string): Promise<never> { void userId; return this.adminManaged(); }
  async consume(deviceId: string, senderId: string, code: string, inboundId: string): Promise<never> {
    void deviceId; void senderId; void code; void inboundId;
    return this.adminManaged();
  }

  async status(userId: string) {
    const binding = await this.prisma.wechatIdentityBinding.findFirst({
      where: { userId, status: 'ACTIVE', device: { status: 'ACTIVE' } }, orderBy: { boundAt: 'desc' },
      include: { device: { select: { name: true } } }
    });
    return binding ? { status: 'BOUND' as const, deviceName: binding.device.name, boundAt: binding.boundAt.toISOString() } : { status: 'UNBOUND' as const };
  }

  async unbind(userId: string) {
    await this.prisma.wechatIdentityBinding.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'DISABLED', version: { increment: 1 }, unboundAt: new Date(), revokedReason: 'USER_UNBOUND' }
    });
    return { status: 'UNBOUND' as const };
  }

  private adminManaged(): never {
    throw new ConflictException({ code: 'WECHAT_BINDING_ADMIN_MANAGED', message: '请联系管理员在后台关联账号，无需验证码或私聊绑定。' });
  }
}
