import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  RegisterSeasonCupRequestSchema,
  ResourceIdSchema,
  WithdrawSeasonCupRequestSchema,
  type RegisterSeasonCupRequest,
  type WithdrawSeasonCupRequest
} from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CompetitionError } from './competition.errors.js';
import { CupCompetitionsService } from './cup-competitions.service.js';
import { CupBracketQueriesService } from './cup-bracket-queries.service.js';

@Controller('cups')
export class CupCompetitionsController {
  constructor(
    @Inject(CupCompetitionsService) private readonly cups: CupCompetitionsService,
    @Inject(CupBracketQueriesService) private readonly bracketQueries: CupBracketQueriesService
  ) {}

  @Get(':competitionId/bracket')
  getBracket(
    @Param('competitionId', new ZodValidationPipe(ResourceIdSchema)) competitionId: string
  ) {
    return this.bracketQueries.getPublished(competitionId);
  }

  @Post(':competitionId/registration')
  @UseGuards(JwtAuthGuard)
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('competitionId', new ZodValidationPipe(ResourceIdSchema)) competitionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(RegisterSeasonCupRequestSchema)) body: RegisterSeasonCupRequest
  ) {
    if (!key?.trim()) {
      throw new CompetitionError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    }
    return this.cups.register(user.id, competitionId, body, key);
  }

  @Get(':competitionId/registration/me')
  @UseGuards(JwtAuthGuard)
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('competitionId', new ZodValidationPipe(ResourceIdSchema)) competitionId: string
  ) {
    return this.cups.getMine(user.id, competitionId);
  }

  @Delete(':competitionId/registration/me')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('competitionId', new ZodValidationPipe(ResourceIdSchema)) competitionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(WithdrawSeasonCupRequestSchema)) body: WithdrawSeasonCupRequest
  ) {
    if (!key?.trim()) {
      throw new CompetitionError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    }
    return this.cups.withdraw(user.id, competitionId, body, key);
  }
}
