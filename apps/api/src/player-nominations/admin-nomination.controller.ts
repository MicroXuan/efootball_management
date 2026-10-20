import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CreateNominationWindowRequestSchema, ResourceIdSchema, UpdateNominationWindowRequestSchema, type CreateNominationWindowRequest, type UpdateNominationWindowRequest } from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminError } from '../admin/admin.errors.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { NominationWindowService } from './nomination-window.service.js';

@Controller('admin/leagues/:leagueId/seasons/:seasonId/nomination-windows')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminNominationController {
  constructor(@Inject(NominationWindowService) private readonly windows: NominationWindowService) {}

  @Get()
  list(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string) {
    return this.windows.list(admin.id, leagueId, seasonId);
  }

  @Post()
  create(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string, @Headers('idempotency-key') key: string | undefined, @Body(new ZodValidationPipe(CreateNominationWindowRequestSchema)) body: CreateNominationWindowRequest) {
    return this.windows.create(admin.id, leagueId, seasonId, body, this.key(key));
  }

  @Patch(':windowId')
  update(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string, @Param('windowId', new ZodValidationPipe(ResourceIdSchema)) windowId: string, @Headers('idempotency-key') key: string | undefined, @Body(new ZodValidationPipe(UpdateNominationWindowRequestSchema)) body: UpdateNominationWindowRequest) {
    return this.windows.update(admin.id, leagueId, seasonId, windowId, body, this.key(key));
  }

  private key(key: string | undefined) {
    if (!key?.trim()) throw new AdminError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return key;
  }
}
