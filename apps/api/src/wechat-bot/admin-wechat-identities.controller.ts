import { Body, Controller, Get, Inject, Param, Put, Query, UseGuards } from '@nestjs/common';
import { AdminWechatIdentityMutationSchema, AdminWechatMembersQuerySchema, ResourceIdSchema, WechatIdentityUserQuerySchema, type AdminWechatIdentityMutation, type AdminWechatMembersQuery } from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard, PlatformAdminOnly } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminWechatIdentitiesService } from './admin-wechat-identities.service.js';

@Controller('admin/wechat-bot/devices/:deviceId')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
@PlatformAdminOnly()
export class AdminWechatIdentitiesController {
  constructor(@Inject(AdminWechatIdentitiesService) private readonly service: AdminWechatIdentitiesService) {}
  @Get('members')
  list(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('deviceId', new ZodValidationPipe(ResourceIdSchema)) deviceId: string,
    @Query(new ZodValidationPipe(AdminWechatMembersQuerySchema)) query: AdminWechatMembersQuery) {
    return this.service.listMembers(admin.id, deviceId, query);
  }
  @Get('user-candidates')
  findUser(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('deviceId', new ZodValidationPipe(ResourceIdSchema)) deviceId: string,
    @Query(new ZodValidationPipe(WechatIdentityUserQuerySchema)) query: { publicUserNo: string }) {
    return this.service.findUser(admin.id, deviceId, query.publicUserNo);
  }
  @Put('identity-bindings')
  save(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('deviceId', new ZodValidationPipe(ResourceIdSchema)) deviceId: string,
    @Body(new ZodValidationPipe(AdminWechatIdentityMutationSchema)) input: AdminWechatIdentityMutation) {
    return this.service.saveBinding(admin.id, deviceId, input);
  }
}

@Controller('admin/leagues/:leagueId/wechat-bot/members')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminLeagueWechatMembersController {
  constructor(@Inject(AdminWechatIdentitiesService) private readonly service: AdminWechatIdentitiesService) {}
  @Get()
  list(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query(new ZodValidationPipe(AdminWechatMembersQuerySchema)) query: AdminWechatMembersQuery) {
    return this.service.listLeagueMembers(admin.id, leagueId, query);
  }
}
