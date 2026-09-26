import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ResourceIdSchema } from '@efm/contracts';
import { z } from 'zod';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { RequirePermission } from '../common/auth/roles.decorator.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CompetitionError } from './competition.errors.js';
import { SchedulesService, type PublishScheduleInput } from './schedules.service.js';

const PublishScheduleRequestSchema = z.object({
  expectedCompetitionVersion: z.number().int().positive(),
  expectedStageVersion: z.number().int().positive()
});

@Controller()
export class SchedulesController {
  constructor(@Inject(SchedulesService) private readonly schedules: SchedulesService) {}

  @Post('admin/competitions/:id/schedule/generate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ScopeGuard)
  @RequirePermission('competition.schedule.manage', { type: 'COMPETITION', param: 'id' })
  generate(@CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string | undefined) {
    return this.schedules.generate(user.id, id, this.key(key));
  }

  @Get('admin/competitions/:id/schedule/preview')
  @UseGuards(JwtAuthGuard, ScopeGuard)
  @RequirePermission('competition.schedule.manage', { type: 'COMPETITION', param: 'id' })
  preview(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.schedules.preview(id);
  }

  @Post('admin/competitions/:id/schedule/publish')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, ScopeGuard)
  @RequirePermission('competition.schedule.manage', { type: 'COMPETITION', param: 'id' })
  publish(@CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(PublishScheduleRequestSchema)) body: PublishScheduleInput) {
    return this.schedules.publish(user.id, id, body, this.key(key));
  }

  @Get('competitions/:id/matches')
  publicMatches(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.schedules.listPublic(id);
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new CompetitionError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
