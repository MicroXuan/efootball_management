import { Body, Controller, Get, Headers, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ResourceIdSchema, SubmitDisappearanceRequestSchema, type SubmitDisappearanceRequest } from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { DisappearanceService } from './disappearance.service.js';

@Controller('me/player-requests')
@UseGuards(JwtAuthGuard)
export class MyPlayerRequestsController {
  constructor(@Inject(DisappearanceService) private readonly disappearances: DisappearanceService) {}

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser, @Query('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string) {
    return this.disappearances.listMine(user.id, seasonId);
  }

}

@Controller('me/league-teams/:teamId/roster/:ownershipId/disappearance-requests')
@UseGuards(JwtAuthGuard)
export class MyDisappearanceSubmitController {
  constructor(@Inject(DisappearanceService) private readonly disappearances: DisappearanceService) {}

  @Post()
  submit(@CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Param('ownershipId', new ZodValidationPipe(ResourceIdSchema)) ownershipId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(SubmitDisappearanceRequestSchema)) body: SubmitDisappearanceRequest) {
    if (!key?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return this.disappearances.submit(user.id, teamId, ownershipId, body, key);
  }
}
