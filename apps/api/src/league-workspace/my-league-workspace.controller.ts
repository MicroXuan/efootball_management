import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ResourceIdSchema } from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueWorkspaceService } from './league-workspace.service.js';

@Controller('me/leagues/:leagueId/workspace')
@UseGuards(JwtAuthGuard)
export class MyLeagueWorkspaceController {
  constructor(@Inject(LeagueWorkspaceService) private readonly workspace: LeagueWorkspaceService) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string
  ) {
    return this.workspace.get(user.id, leagueId, seasonId);
  }
}
