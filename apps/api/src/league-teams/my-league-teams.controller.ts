import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ResourceIdSchema } from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueTeamsService } from './league-teams.service.js';

@Controller('me/league-teams')
@UseGuards(JwtAuthGuard)
export class MyLeagueTeamsController {
  constructor(@Inject(LeagueTeamsService) private readonly teams: LeagueTeamsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.teams.listMineViews(user.id);
  }

  @Get(':teamId/overview')
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string
  ) {
    return this.teams.getMyOverview(teamId, user.id);
  }

  @Get(':teamId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string
  ) {
    return this.teams.getDetail(teamId, user.id);
  }
}
