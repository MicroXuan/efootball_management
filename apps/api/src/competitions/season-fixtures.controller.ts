import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import {
  ResourceIdSchema,
  SeasonFixtureListQuerySchema,
  SeasonFixtureListResponseSchema,
  type SeasonFixtureListQuery
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { SeasonFixturesService } from './season-fixtures.service.js';

@Controller('me/leagues/:leagueId/seasons/:seasonId/fixtures')
@UseGuards(JwtAuthGuard)
export class SeasonFixturesController {
  constructor(@Inject(SeasonFixturesService) private readonly fixtures: SeasonFixturesService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Query(new ZodValidationPipe(SeasonFixtureListQuerySchema)) query: SeasonFixtureListQuery
  ) {
    return SeasonFixtureListResponseSchema.parse(await this.fixtures.list(user.id, leagueId, seasonId, query));
  }
}
