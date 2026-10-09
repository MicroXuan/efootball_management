import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { WECHAT_BOT_CONFIG } from './wechat-bot.config.js';
import type { WechatBotRuntimeConfig } from './wechat-bot.config.js';

@Injectable()
export class WechatRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WECHAT_BOT_CONFIG) private readonly config: WechatBotRuntimeConfig
  ) {}

  async onApplicationBootstrap() {
    await this.cleanup();
    this.timer = setInterval(() => void this.cleanup(), 60 * 60 * 1_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async cleanup() {
    const now = Date.now();
    const [requestReceipts, commandTexts] = await Promise.all([
      this.prisma.wechatBridgeRequestReceipt.deleteMany({
        where: { receivedAt: { lt: new Date(now - 24 * 60 * 60 * 1_000) } }
      }),
      this.prisma.wechatInboundMessage.updateMany({
        where: {
          receivedAt: { lt: new Date(now - this.config.commandRetentionHours * 60 * 60 * 1_000) },
          commandText: { not: null }
        },
        data: { commandText: null }
      })
    ]);
    return { requestReceipts: requestReceipts.count, commandTexts: commandTexts.count };
  }
}
