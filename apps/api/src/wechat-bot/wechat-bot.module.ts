import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import {
  AdminLeagueWechatBotController,
  AdminWechatBotDevicesController
} from './admin-wechat-bot.controller.js';
import { AdminWechatBotService } from './admin-wechat-bot.service.js';
import { WechatBridgeAuthGuard } from './wechat-bridge-auth.guard.js';
import { WechatBindingService } from './wechat-binding.service.js';
import { WechatBindingsController } from './wechat-bindings.controller.js';
import { WechatBridgeController } from './wechat-bridge.controller.js';
import { WechatBridgeService } from './wechat-bridge.service.js';
import { WechatCommandRouterService } from './wechat-command-router.service.js';
import { WECHAT_BOT_CONFIG } from './wechat-bot.config.js';
import type { WechatBotRuntimeConfig } from './wechat-bot.config.js';
import { WechatOutboxService } from './wechat-outbox.service.js';
import { WechatRetentionService } from './wechat-retention.service.js';
import { WechatScheduleQueryService } from './wechat-schedule-query.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule, JwtModule.register({})],
  controllers: [
    AdminLeagueWechatBotController,
    AdminWechatBotDevicesController,
    WechatBridgeController,
    WechatBindingsController
  ],
  providers: [
    {
      provide: WECHAT_BOT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): WechatBotRuntimeConfig => config.getOrThrow('wechatBot')
    },
    AdminWechatBotService,
    WechatBridgeAuthGuard,
    WechatBindingService,
    WechatBridgeService,
    WechatCommandRouterService,
    WechatOutboxService,
    WechatRetentionService,
    WechatScheduleQueryService
  ],
  exports: [WechatBindingService, WechatBridgeService, WechatOutboxService, WechatRetentionService]
})
export class WechatBotModule {}
