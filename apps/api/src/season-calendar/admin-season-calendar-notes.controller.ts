import { Body, Controller, Delete, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CreateSeasonCalendarNoteRequestSchema, ResourceIdSchema, UpdateSeasonCalendarNoteRequestSchema,
  type CreateSeasonCalendarNoteRequest, type UpdateSeasonCalendarNoteRequest } from '@efm/contracts';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { SeasonCalendarNoteService } from './season-calendar-note.service.js';

const RemoveSchema = z.object({ expectedVersion: z.number().int().positive() });

@Controller('admin/leagues/:leagueId/seasons/:seasonId/calendar-notes')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminSeasonCalendarNotesController {
  constructor(@Inject(SeasonCalendarNoteService) private readonly notes: SeasonCalendarNoteService) {}

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Body(new ZodValidationPipe(CreateSeasonCalendarNoteRequestSchema)) body: CreateSeasonCalendarNoteRequest,
    @Headers('idempotency-key') key?: string
  ) {
    return this.notes.create(admin.id, leagueId, seasonId, body, this.key(key));
  }

  @Patch(':noteId')
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Param('noteId', new ZodValidationPipe(ResourceIdSchema)) noteId: string,
    @Body(new ZodValidationPipe(UpdateSeasonCalendarNoteRequestSchema)) body: UpdateSeasonCalendarNoteRequest,
    @Headers('idempotency-key') key?: string
  ) {
    return this.notes.update(admin.id, leagueId, seasonId, noteId, body, this.key(key));
  }

  @Delete(':noteId')
  remove(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Param('noteId', new ZodValidationPipe(ResourceIdSchema)) noteId: string,
    @Body(new ZodValidationPipe(RemoveSchema)) body: z.infer<typeof RemoveSchema>,
    @Headers('idempotency-key') key?: string
  ) {
    return this.notes.remove(admin.id, leagueId, seasonId, noteId, body.expectedVersion, this.key(key));
  }

  private key(value?: string): string {
    if (!value?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return value;
  }
}
