import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateLeagueSeasonRequestSchema,
  EnrollLeagueTeamsRequestSchema,
  ResourceIdSchema,
  SetCurrentSeasonRequestSchema,
  UpdateLeagueSeasonRequestSchema,
  type EnrollLeagueTeamsRequest,
  type ParsedCreateLeagueSeasonRequest,
  type SetCurrentSeasonRequest,
  type UpdateLeagueSeasonRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminError } from './admin.errors.js';
import { AdminLeagueSeasonsService } from './admin-league-seasons.service.js';
import { AdminScopeGuard } from './admin-scope.guard.js';

@Controller('admin/leagues/:leagueId/seasons')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminLeagueSeasonsController {
  constructor(
    @Inject(AdminLeagueSeasonsService) private readonly seasons: AdminLeagueSeasonsService
  ) {}

  @Get()
  list(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string
  ) {
    return this.seasons.list(admin.id, leagueId);
  }

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateLeagueSeasonRequestSchema)) body: ParsedCreateLeagueSeasonRequest
  ) {
    return this.seasons.create(admin.id, leagueId, body, this.key(key));
  }

  @Patch(':seasonId')
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpdateLeagueSeasonRequestSchema)) body: UpdateLeagueSeasonRequest
  ) {
    return this.seasons.update(admin.id, leagueId, seasonId, body, this.key(key));
  }

  @Post(':seasonId/set-current')
  setCurrent(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(SetCurrentSeasonRequestSchema)) body: SetCurrentSeasonRequest
  ) {
    return this.seasons.setCurrent(admin.id, leagueId, seasonId, body, this.key(key));
  }

  @Post(':seasonId/teams')
  enrollTeams(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(EnrollLeagueTeamsRequestSchema)) body: EnrollLeagueTeamsRequest
  ) {
    return this.seasons.enrollTeams(admin.id, leagueId, seasonId, body, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new AdminError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
