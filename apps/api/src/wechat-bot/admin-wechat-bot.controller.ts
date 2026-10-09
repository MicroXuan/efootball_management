import { Body, Controller, Get, Inject, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  CreateWechatBotDeviceRequestSchema,
  ResourceIdSchema,
  SaveWechatGroupBindingRequestSchema,
  UpdateWechatBotDeviceStatusRequestSchema,
  type CreateWechatBotDeviceRequest,
  type SaveWechatGroupBindingRequest,
  type UpdateWechatBotDeviceStatusRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard, PlatformAdminOnly } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminWechatBotService } from './admin-wechat-bot.service.js';

@Controller('admin/wechat-bot/devices')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
@PlatformAdminOnly()
export class AdminWechatBotDevicesController {
  constructor(@Inject(AdminWechatBotService) private readonly service: AdminWechatBotService) {}

  @Get()
  list() {
    return this.service.listDevices();
  }

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(CreateWechatBotDeviceRequestSchema)) body: CreateWechatBotDeviceRequest
  ) {
    return this.service.createDevice(admin.id, body);
  }

  @Patch(':deviceId/status')
  status(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('deviceId', new ZodValidationPipe(ResourceIdSchema)) deviceId: string,
    @Body(new ZodValidationPipe(UpdateWechatBotDeviceStatusRequestSchema)) body: UpdateWechatBotDeviceStatusRequest
  ) {
    return this.service.setDeviceStatus(admin.id, deviceId, body);
  }

  @Post(':deviceId/token/rotate')
  rotate(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('deviceId', new ZodValidationPipe(ResourceIdSchema)) deviceId: string
  ) {
    return this.service.rotateToken(admin.id, deviceId);
  }

  @Post(':deviceId/circuit/reset')
  resetCircuit(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('deviceId', new ZodValidationPipe(ResourceIdSchema)) deviceId: string
  ) {
    return this.service.resetCircuit(admin.id, deviceId);
  }

  @Get(':deviceId/observed-groups')
  groups(@Param('deviceId', new ZodValidationPipe(ResourceIdSchema)) deviceId: string) {
    return this.service.listObservedGroups(deviceId);
  }
}

@Controller('admin/leagues/:leagueId/wechat-bot')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminLeagueWechatBotController {
  constructor(@Inject(AdminWechatBotService) private readonly service: AdminWechatBotService) {}

  @Get()
  get(@Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string) {
    return this.service.getLeagueConfig(leagueId);
  }

  @Put('group')
  save(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Body(new ZodValidationPipe(SaveWechatGroupBindingRequestSchema)) body: SaveWechatGroupBindingRequest
  ) {
    return this.service.saveGroupBinding(admin.id, leagueId, body);
  }
}
