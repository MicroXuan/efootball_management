import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ResourceIdSchema, SubmitNominationRequestSchema, type SubmitNominationRequest } from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { NominationService } from './nomination.service.js';

@Controller('me/leagues/:leagueId/seasons/:seasonId/nomination-windows')
@UseGuards(JwtAuthGuard)
export class MyNominationWindowsController {
  constructor(@Inject(NominationService) private readonly nominations: NominationService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string) {
    return this.nominations.listWindows(user.id, leagueId, seasonId);
  }
}

@Controller('me/nomination-windows/:windowId/nominations')
@UseGuards(JwtAuthGuard)
export class MyNominationsController {
  constructor(@Inject(NominationService) private readonly nominations: NominationService) {}

  @Get()
  workspace(@CurrentUser() user: AuthenticatedUser, @Param('windowId', new ZodValidationPipe(ResourceIdSchema)) windowId: string) {
    return this.nominations.workspace(user.id, windowId);
  }

  @Post()
  submit(@CurrentUser() user: AuthenticatedUser, @Param('windowId', new ZodValidationPipe(ResourceIdSchema)) windowId: string, @Headers('idempotency-key') key: string | undefined, @Body(new ZodValidationPipe(SubmitNominationRequestSchema)) body: SubmitNominationRequest) {
    return this.nominations.submit(user.id, windowId, body, this.key(key));
  }

  @Delete(':nominationId')
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('windowId', new ZodValidationPipe(ResourceIdSchema)) windowId: string, @Param('nominationId', new ZodValidationPipe(ResourceIdSchema)) nominationId: string, @Headers('idempotency-key') key: string | undefined) {
    return this.nominations.withdraw(user.id, windowId, nominationId, this.key(key));
  }

  private key(key: string | undefined) {
    if (!key?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return key;
  }
}
