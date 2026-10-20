import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ResourceIdSchema } from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TeamAssetsService } from './team-assets.service.js';

@Controller('me/leagues/:leagueId/teams')
@UseGuards(JwtAuthGuard)
export class PublicTeamAssetsController {
  constructor(@Inject(TeamAssetsService) private readonly assets: TeamAssetsService) {}

  @Get()
  directory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string
  ) {
    return this.assets.listPublicTeams(user.id, leagueId);
  }

  @Get(':teamId/public-assets')
  teamAssets(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string
  ) {
    return this.assets.getPublicTeamAssets(user.id, leagueId, teamId);
  }
}
