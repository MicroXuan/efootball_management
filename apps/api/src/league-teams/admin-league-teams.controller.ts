import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateLeagueTeamRequestSchema,
  ResourceIdSchema,
  UpdateLeagueTeamRequestSchema,
  type ParsedCreateLeagueTeamRequest,
  type UpdateLeagueTeamRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { LeagueTeamsService } from './league-teams.service.js';

@Controller('admin/leagues/:leagueId/teams')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminLeagueTeamsController {
  constructor(@Inject(LeagueTeamsService) private readonly teams: LeagueTeamsService) {}

  @Get()
  list(@Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string) {
    return this.teams.listForLeague(leagueId);
  }

  @Get(':teamId')
  get(
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string
  ) {
    return this.teams.getDetail(teamId, undefined, leagueId);
  }

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateLeagueTeamRequestSchema)) body: ParsedCreateLeagueTeamRequest
  ) {
    return this.teams.create(admin.id, leagueId, body, this.key(key));
  }

  @Patch(':teamId')
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpdateLeagueTeamRequestSchema)) body: UpdateLeagueTeamRequest
  ) {
    return this.teams.update(admin.id, leagueId, teamId, body, this.key(key));
  }

  private key(value: string | undefined) {
    if (!value?.trim()) {
      throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
