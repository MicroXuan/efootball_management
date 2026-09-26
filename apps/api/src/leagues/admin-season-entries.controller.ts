import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CancelLeagueSeasonRequestSchema,
  OverrideSeasonEntryRequestSchema,
  ResourceIdSchema,
  SeasonEntryListQuerySchema,
  SeasonTransitionRequestSchema,
  type CancelLeagueSeasonRequest,
  type OverrideSeasonEntryRequest,
  type SeasonEntryListQuery,
  type SeasonTransitionRequest
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { RequirePermission } from '../common/auth/roles.decorator.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from './league.errors.js';
import { SeasonEntriesService } from './season-entries.service.js';

@Controller('admin/seasons/:seasonId/entries')
@UseGuards(JwtAuthGuard, ScopeGuard)
@RequirePermission('season.manage', { type: 'SEASON', param: 'seasonId' })
export class AdminSeasonEntriesController {
  constructor(@Inject(SeasonEntriesService) private readonly entries: SeasonEntriesService) {}

  @Get()
  list(
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Query(new ZodValidationPipe(SeasonEntryListQuerySchema)) query: SeasonEntryListQuery
  ) {
    return this.entries.listForManager(seasonId, query);
  }

  @Post(':entryId/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Param('entryId', new ZodValidationPipe(ResourceIdSchema)) entryId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(SeasonTransitionRequestSchema)) body: SeasonTransitionRequest
  ) {
    return this.entries.review(user.id, seasonId, entryId, {
      ...body,
      decision: 'APPROVE'
    }, this.key(key));
  }

  @Post(':entryId/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Param('entryId', new ZodValidationPipe(ResourceIdSchema)) entryId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CancelLeagueSeasonRequestSchema)) body: CancelLeagueSeasonRequest
  ) {
    return this.entries.review(user.id, seasonId, entryId, {
      expectedVersion: body.expectedVersion,
      decision: 'REJECT',
      reason: body.reason
    }, this.key(key));
  }

  @Post(':entryId/override')
  @HttpCode(200)
  override(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Param('entryId', new ZodValidationPipe(ResourceIdSchema)) entryId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(OverrideSeasonEntryRequestSchema)) body: OverrideSeasonEntryRequest
  ) {
    return this.entries.override(user.id, seasonId, entryId, body, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
