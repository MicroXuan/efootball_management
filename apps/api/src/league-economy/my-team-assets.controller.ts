import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ResourceIdSchema } from '@efm/contracts';
import { z } from 'zod';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TeamAssetsService } from './team-assets.service.js';
import { TeamFinanceService } from './team-finance.service.js';

const FinanceQuerySchema = z.object({ seasonId: ResourceIdSchema.optional() });

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MyTeamAssetsController {
  constructor(
    @Inject(TeamAssetsService) private readonly assets: TeamAssetsService,
    @Inject(TeamFinanceService) private readonly finance: TeamFinanceService
  ) {}

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

  @Get('league-teams/:teamId/finance')
  teamFinance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Query(new ZodValidationPipe(FinanceQuerySchema)) query: z.output<typeof FinanceQuerySchema>
  ) {
    return this.finance.getSeasonSummary(user.id, teamId, query.seasonId ?? null);
  }
}
