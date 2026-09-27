import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateLeagueRequestSchema,
  ResourceIdSchema,
  UpdateLeagueRequestSchema,
  type ParsedCreateLeagueRequest,
  type UpdateLeagueRequest
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { RequirePermission } from '../common/auth/roles.decorator.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from './league.errors.js';
import { LeaguesService } from './leagues.service.js';

@Controller('admin/leagues')
@UseGuards(JwtAuthGuard, ScopeGuard)
export class AdminLeaguesController {
  constructor(@Inject(LeaguesService) private readonly leagues: LeaguesService) {}

  @Get(':leagueId')
  @RequirePermission('league.manage', { type: 'LEAGUE', param: 'leagueId' })
  get(@Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string) {
    return this.leagues.getManaged(leagueId);
  }

  @Post()
  @RequirePermission('league.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateLeagueRequestSchema)) body: ParsedCreateLeagueRequest
  ) {
    return this.leagues.create(user.id, body, this.key(key));
  }

  @Patch(':leagueId')
  @RequirePermission('league.manage', { type: 'LEAGUE', param: 'leagueId' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpdateLeagueRequestSchema)) body: UpdateLeagueRequest
  ) {
    return this.leagues.update(user.id, leagueId, body, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
