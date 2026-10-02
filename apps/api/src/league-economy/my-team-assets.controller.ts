import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ResourceIdSchema } from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TeamAssetsService } from './team-assets.service.js';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MyTeamAssetsController {
  constructor(@Inject(TeamAssetsService) private readonly assets: TeamAssetsService) {}

  @Get('league-teams/:teamId/assets')
  teamAssets(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string
  ) {
    return this.assets.getTeamAssets(user.id, teamId);
  }

  @Get('leagues/:leagueId/player-valuations/:playerId/history')
  valuationHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('playerId', new ZodValidationPipe(ResourceIdSchema)) playerId: string
  ) {
    return this.assets.getPlayerValuationHistory(user.id, leagueId, playerId);
  }
}
