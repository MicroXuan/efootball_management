import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { LeagueListQuerySchema, ResourceIdSchema, type LeagueListQuery } from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { OptionalJwtAuthGuard } from '../common/auth/optional-jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeaguesService } from './leagues.service.js';

@Controller('leagues')
export class PublicLeaguesController {
  constructor(@Inject(LeaguesService) private readonly leagues: LeaguesService) {}

  @Get()
  list(@Query(new ZodValidationPipe(LeagueListQuerySchema)) query: LeagueListQuery) {
    return this.leagues.listPublic(query);
  }

  @Get(':leagueId')
  @UseGuards(OptionalJwtAuthGuard)
  get(
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @CurrentUser() user?: AuthenticatedUser
  ) {
    return this.leagues.getPublic(leagueId, user?.id);
  }
}
