import { Body, Controller, Get, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  ConfirmSeasonAllocationRequestSchema,
  GenerateSeasonAllocationRequestSchema,
  ResourceIdSchema,
  SeasonTransitionRequestSchema,
  type ConfirmSeasonAllocationRequest,
  type GenerateSeasonAllocationRequest,
  type SeasonTransitionRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueAllocationError } from './league-allocation.errors.js';
import { LeagueAllocationService } from './league-allocation.service.js';

@Controller('admin/leagues/:leagueId/seasons/:seasonId')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminLeagueAllocationController {
  constructor(@Inject(LeagueAllocationService) private readonly allocations: LeagueAllocationService) {}

  @Post('allocation-proposals')
  generate(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(GenerateSeasonAllocationRequestSchema)) body: GenerateSeasonAllocationRequest
  ) {
    if (!key?.trim()) {
      throw new LeagueAllocationError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    }
    return this.allocations.generate(admin.id, leagueId, seasonId, body, key);
  }

  @Get('allocation-proposals/latest')
  latest(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string
  ) {
    return this.allocations.latest(admin.id, leagueId, seasonId);
  }

  @Post('allocation-decisions')
  confirm(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ConfirmSeasonAllocationRequestSchema)) body: ConfirmSeasonAllocationRequest
  ) {
    return this.allocations.confirm(admin.id, leagueId, seasonId, body, this.key(key));
  }

  @Post('reopen-allocation')
  reopen(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(SeasonTransitionRequestSchema)) body: SeasonTransitionRequest
  ) {
    return this.allocations.reopen(admin.id, leagueId, seasonId, body, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new LeagueAllocationError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    }
    return value;
  }
}
