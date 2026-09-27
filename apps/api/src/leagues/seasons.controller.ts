import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards
} from '@nestjs/common';
import {
  CancelLeagueSeasonRequestSchema,
  CreateLeagueSeasonRequestSchema,
  ResourceIdSchema,
  SeasonTransitionRequestSchema,
  UpdateLeagueSeasonRequestSchema,
  type CancelLeagueSeasonRequest,
  type ParsedCreateLeagueSeasonRequest,
  type SeasonTransitionRequest,
  type UpdateLeagueSeasonRequest
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { RequirePermission } from '../common/auth/roles.decorator.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from './league.errors.js';
import { SeasonsService } from './seasons.service.js';

@Controller()
export class PublicSeasonsController {
  constructor(@Inject(SeasonsService) private readonly seasons: SeasonsService) {}

  @Get('leagues/:leagueId/seasons')
  list(@Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string) {
    return this.seasons.listPublic(leagueId);
  }

  @Get('seasons/:seasonId')
  get(@Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string) {
    return this.seasons.getPublic(seasonId);
  }
}

@Controller()
@UseGuards(JwtAuthGuard, ScopeGuard)
export class AdminSeasonsController {
  constructor(@Inject(SeasonsService) private readonly seasons: SeasonsService) {}

  @Get('admin/leagues/:leagueId/seasons')
  @RequirePermission('season.manage', { type: 'LEAGUE', param: 'leagueId' })
  list(@Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string) {
    return this.seasons.listManaged(leagueId);
  }

  @Get('admin/seasons/:seasonId')
  @RequirePermission('season.manage', { type: 'SEASON', param: 'seasonId' })
  get(@Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string) {
    return this.seasons.getManaged(seasonId);
  }

  @Post('admin/leagues/:leagueId/seasons')
  @RequirePermission('season.manage', { type: 'LEAGUE', param: 'leagueId' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateLeagueSeasonRequestSchema)) body: ParsedCreateLeagueSeasonRequest
  ) {
    return this.seasons.create(user.id, leagueId, body, this.key(key));
  }

  @Patch('admin/seasons/:seasonId')
  @RequirePermission('season.manage', { type: 'SEASON', param: 'seasonId' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpdateLeagueSeasonRequestSchema)) body: UpdateLeagueSeasonRequest
  ) {
    return this.seasons.update(user.id, seasonId, body, this.key(key));
  }

  @Post('admin/seasons/:seasonId/open-registration')
  @HttpCode(200)
  @RequirePermission('season.manage', { type: 'SEASON', param: 'seasonId' })
  open(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(SeasonTransitionRequestSchema)) body: SeasonTransitionRequest
  ) {
    return this.seasons.transition(user.id, seasonId, 'REGISTRATION_OPEN', body, this.key(key));
  }

  @Post('admin/seasons/:seasonId/close-registration')
  @HttpCode(200)
  @RequirePermission('season.manage', { type: 'SEASON', param: 'seasonId' })
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(SeasonTransitionRequestSchema)) body: SeasonTransitionRequest
  ) {
    return this.seasons.transition(user.id, seasonId, 'ALLOCATION_REVIEW', body, this.key(key));
  }

  @Post('admin/seasons/:seasonId/cancel')
  @HttpCode(200)
  @RequirePermission('season.manage', { type: 'SEASON', param: 'seasonId' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CancelLeagueSeasonRequestSchema)) body: CancelLeagueSeasonRequest
  ) {
    return this.seasons.transition(user.id, seasonId, 'CANCELLED', body, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
