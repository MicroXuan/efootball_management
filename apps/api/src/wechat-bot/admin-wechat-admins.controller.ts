import { Body, Controller, Get, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { ResourceIdSchema, WechatAdminBindingMutationSchema, type WechatAdminBindingMutation } from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard, PlatformAdminOnly } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminWechatAdminsService } from './admin-wechat-admins.service.js';

@Controller('admin/wechat-bot/devices/:deviceId/private-admins')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
@PlatformAdminOnly()
export class AdminWechatAdminsController {
  constructor(@Inject(AdminWechatAdminsService) private readonly service: AdminWechatAdminsService) {}
  @Get()
  list(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('deviceId', new ZodValidationPipe(ResourceIdSchema)) deviceId: string) {
    return this.service.list(admin.id, deviceId);
  }
  @Put(':contactId')
  bind(@CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('deviceId', new ZodValidationPipe(ResourceIdSchema)) deviceId: string,
    @Param('contactId', new ZodValidationPipe(ResourceIdSchema)) contactId: string,
    @Body(new ZodValidationPipe(WechatAdminBindingMutationSchema)) input: WechatAdminBindingMutation) {
    return this.service.bind(admin.id, deviceId, contactId, input);
  }
}
