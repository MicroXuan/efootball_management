import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { WechatBridgeHeartbeat, WechatInboundBatch, WechatOutboxAck, WechatOutboxClaimRequest } from '@efm/contracts';
import {
  ResourceIdSchema,
  WechatBridgeHeartbeatSchema,
  WechatInboundBatchSchema,
  WechatOutboxAckSchema,
  WechatOutboxClaimRequestSchema
} from '@efm/contracts';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { WechatBridgeAuthGuard } from './wechat-bridge-auth.guard.js';
import type { BridgeRequest } from './wechat-bridge-auth.guard.js';
import { WechatBridgeService } from './wechat-bridge.service.js';
import { WechatOutboxService } from './wechat-outbox.service.js';

@Controller('wechat-bot/bridge')
@UseGuards(WechatBridgeAuthGuard)
export class WechatBridgeController {
  constructor(
    @Inject(WechatBridgeService) private readonly bridge: WechatBridgeService,
    @Inject(WechatOutboxService) private readonly outbox: WechatOutboxService
  ) {}

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(
    @Req() request: BridgeRequest,
    @Body(new ZodValidationPipe(WechatBridgeHeartbeatSchema)) body: WechatBridgeHeartbeat
  ) {
    return this.bridge.heartbeat(request.bridgePrincipal!.deviceId, body);
  }

  @Post('messages')
  @HttpCode(200)
  messages(
    @Req() request: BridgeRequest,
    @Body(new ZodValidationPipe(WechatInboundBatchSchema)) body: WechatInboundBatch
  ) {
    return this.bridge.acceptBatch(request.bridgePrincipal!.deviceId, body);
  }

  @Post('outbox/claim')
  @HttpCode(200)
  claim(
    @Req() request: BridgeRequest,
    @Body(new ZodValidationPipe(WechatOutboxClaimRequestSchema)) body: WechatOutboxClaimRequest
  ) {
    return this.outbox.claim(request.bridgePrincipal!.deviceId, body.limit);
  }

  @Post('outbox/:id/ack')
  @HttpCode(200)
  ack(
    @Req() request: BridgeRequest,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Body(new ZodValidationPipe(WechatOutboxAckSchema)) body: WechatOutboxAck
  ) {
    return this.outbox.ack(request.bridgePrincipal!.deviceId, id, body);
  }
}
