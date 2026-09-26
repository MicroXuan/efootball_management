import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { LeagueListQuerySchema, ResourceIdSchema, type LeagueListQuery } from '@efm/contracts';
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
  get(@Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string) {
    return this.leagues.getPublic(leagueId);
  }
}
