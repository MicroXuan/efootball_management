import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WechatBridgeAuthGuard } from './wechat-bridge-auth.guard.js';
import { WechatBridgeController } from './wechat-bridge.controller.js';
import { WechatBridgeService } from './wechat-bridge.service.js';
import { WECHAT_BOT_CONFIG } from './wechat-bot.config.js';
import type { WechatBotRuntimeConfig } from './wechat-bot.config.js';
import { WechatOutboxService } from './wechat-outbox.service.js';
import { WechatRetentionService } from './wechat-retention.service.js';

@Module({
  controllers: [WechatBridgeController],
  providers: [
    {
      provide: WECHAT_BOT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): WechatBotRuntimeConfig => config.getOrThrow('wechatBot')
    },
    WechatBridgeAuthGuard,
    WechatBridgeService,
    WechatOutboxService,
    WechatRetentionService
  ],
  exports: [WechatBridgeService, WechatOutboxService, WechatRetentionService]
})
export class WechatBotModule {}
