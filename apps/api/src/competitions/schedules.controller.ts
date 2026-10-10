import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  GenerateStageScheduleRequestSchema,
  PublishStageScheduleRequestSchema,
  ResourceIdSchema,
  type GenerateStageScheduleRequest,
  type PublishStageScheduleRequest
} from '@efm/contracts';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
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

  @Post('admin/leagues/:leagueId/competition-stages/:stageId/schedule/generate')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard, AdminScopeGuard)
  generateStage(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('stageId', new ZodValidationPipe(ResourceIdSchema)) stageId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(GenerateStageScheduleRequestSchema)) body: GenerateStageScheduleRequest
  ) {
    return this.schedules.generateStage(admin.id, leagueId, stageId, body, this.key(key));
  }

  @Get('admin/leagues/:leagueId/competition-stages/:stageId/schedule')
  @UseGuards(AdminAuthGuard, AdminScopeGuard)
  previewLeagueStage(
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('stageId', new ZodValidationPipe(ResourceIdSchema)) stageId: string
  ) {
    return this.schedules.previewStageForLeague(leagueId, stageId);
  }

  @Post('admin/leagues/:leagueId/competition-stages/:stageId/schedule/publish')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard, AdminScopeGuard)
  publishStage(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('stageId', new ZodValidationPipe(ResourceIdSchema)) stageId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(PublishStageScheduleRequestSchema)) body: PublishStageScheduleRequest
  ) {
    return this.schedules.publishStage(admin.id, leagueId, stageId, body, this.key(key));
  }

  @Get('competition-stages/:stageId/schedule')
  stageSchedule(@Param('stageId', new ZodValidationPipe(ResourceIdSchema)) stageId: string) {
    return this.schedules.listStagePublic(stageId);
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new CompetitionError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    }
    return value;
  }
}
