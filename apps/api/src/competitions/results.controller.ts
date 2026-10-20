import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  ManagerMatchResultRequestSchema,
  ResourceIdSchema,
  type ManagerMatchResultRequest
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { RequirePermission } from '../common/auth/roles.decorator.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CompetitionError } from './competition.errors.js';
import { ResultsService } from './results.service.js';
import { StandingsService } from './standings.service.js';

@Controller()
export class ResultsController {
  constructor(
    @Inject(ResultsService) private readonly results: ResultsService,
    @Inject(StandingsService) private readonly standings: StandingsService
  ) {}

  @Post('admin/competitions/:id/matches/:matchId/results')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ScopeGuard)
  @RequirePermission('competition.result.manage', { type: 'COMPETITION', param: 'id' })
  manager(@CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Param('matchId', new ZodValidationPipe(ResourceIdSchema)) matchId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ManagerMatchResultRequestSchema)) body: ManagerMatchResultRequest) {
    return this.results.recordByManager(user.id, id, matchId, body, this.key(key));
  }

  @Post('admin/leagues/:leagueId/competitions/:id/matches/:matchId/results')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard, AdminScopeGuard)
  leagueAdmin(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Param('matchId', new ZodValidationPipe(ResourceIdSchema)) matchId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ManagerMatchResultRequestSchema)) body: ManagerMatchResultRequest
  ) {
    return this.results.recordByLeagueAdmin(admin.id, leagueId, id, matchId, body, this.key(key));
  }

  @Get('competitions/:id/standings')
  publicStandings(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.standings.getLatestPublic(id);
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new CompetitionError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
