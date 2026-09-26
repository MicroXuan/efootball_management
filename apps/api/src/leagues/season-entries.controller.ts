import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  ConfirmSeasonRenewalRequestSchema,
  CreateSeasonApplicationRequestSchema,
  ResourceIdSchema,
  WithdrawSeasonEntryRequestSchema,
  type ConfirmSeasonRenewalRequest,
  type CreateSeasonApplicationRequest,
  type WithdrawSeasonEntryRequest
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from './league.errors.js';
import { SeasonEntriesService } from './season-entries.service.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class SeasonEntriesController {
  constructor(@Inject(SeasonEntriesService) private readonly entries: SeasonEntriesService) {}

  @Get('seasons/:seasonId/entries/me')
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string
  ) {
    return this.entries.getMine(user.id, seasonId);
  }

  @Post('seasons/:seasonId/applications')
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateSeasonApplicationRequestSchema)) body: CreateSeasonApplicationRequest
  ) {
    return this.entries.apply(user.id, seasonId, body, this.key(key));
  }

  @Post('seasons/:seasonId/renewal/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ConfirmSeasonRenewalRequestSchema)) body: ConfirmSeasonRenewalRequest
  ) {
    return this.entries.confirmRenewal(user.id, seasonId, body, this.key(key));
  }

  @Delete('seasons/:seasonId/entries/me')
  @HttpCode(200)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(WithdrawSeasonEntryRequestSchema)) body: WithdrawSeasonEntryRequest
  ) {
    return this.entries.withdraw(user.id, seasonId, body, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
