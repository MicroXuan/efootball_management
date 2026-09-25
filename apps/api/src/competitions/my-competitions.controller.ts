import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  MyCompetitionListQuerySchema,
  MyMatchListQuerySchema,
  type MyCompetitionListQuery,
  type MyMatchListQuery
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { MyCompetitionsService } from './my-competitions.service.js';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MyCompetitionsController {
  constructor(@Inject(MyCompetitionsService) private readonly dashboard: MyCompetitionsService) {}

  @Get('competitions')
  competitions(@CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(MyCompetitionListQuerySchema)) query: MyCompetitionListQuery) {
    return this.dashboard.listCompetitions(user.id, query);
  }

  @Get('matches')
  matches(@CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(MyMatchListQuerySchema)) query: MyMatchListQuery) {
    return this.dashboard.listMatches(user.id, query);
  }
}
