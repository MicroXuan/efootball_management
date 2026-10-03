import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { CompetitionListQuerySchema, ResourceIdSchema, type CompetitionListQuery } from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CompetitionsService } from './competitions.service.js';
import { StandingsService } from './standings.service.js';

@Controller('competitions')
export class PublicCompetitionsController {
  constructor(@Inject(CompetitionsService) private readonly competitions: CompetitionsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(CompetitionListQuerySchema)) query: CompetitionListQuery) {
    return this.competitions.listPublic(query);
  }

  @Get(':id')
  get(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.competitions.getPublic(id);
  }
}

@Controller('me/leagues/:leagueId/seasons/:seasonId/division-standings')
@UseGuards(JwtAuthGuard)
export class MyDivisionStandingsController {
  constructor(@Inject(StandingsService) private readonly standings: StandingsService) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string
  ) {
    return this.standings.getDivisionStandings(user.id, leagueId, seasonId);
  }
}
