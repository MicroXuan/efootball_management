import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateForcedOfferWindowRequestSchema, ResourceIdSchema, UpdateForcedOfferWindowRequestSchema,
  type CreateForcedOfferWindowRequest, type UpdateForcedOfferWindowRequest,
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ForcedOfferWindowsService } from './forced-offer-windows.service.js';
import { playerMarketError } from './player-market.errors.js';

@Controller('admin/leagues/:leagueId/seasons/:seasonId/forced-offer-windows')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminForcedOfferWindowsController {
  constructor(@Inject(ForcedOfferWindowsService) private readonly windows: ForcedOfferWindowsService) {}

  @Get()
  list(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
  ) {
    return this.windows.list(admin.id, leagueId, seasonId);
  }

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Body(new ZodValidationPipe(CreateForcedOfferWindowRequestSchema)) body: CreateForcedOfferWindowRequest,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.windows.create(admin.id, leagueId, seasonId, body, this.key(key));
  }

  @Patch(':windowId')
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Param('windowId', new ZodValidationPipe(ResourceIdSchema)) windowId: string,
    @Body(new ZodValidationPipe(UpdateForcedOfferWindowRequestSchema)) body: UpdateForcedOfferWindowRequest,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.windows.update(admin.id, leagueId, seasonId, windowId, body, this.key(key));
  }

  private key(value?: string) {
    if (!value?.trim()) throw playerMarketError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return value;
  }
}
