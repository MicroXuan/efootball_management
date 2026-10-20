import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ResourceIdSchema, SeasonAgendaMonthSchema, SeasonAgendaResponseSchema } from '@efm/contracts';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { SeasonCalendarService } from './season-calendar.service.js';

const AgendaQuerySchema = z.object({ month: SeasonAgendaMonthSchema });

@Controller('admin/leagues/:leagueId/current-season/agenda')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminSeasonCalendarController {
  constructor(@Inject(SeasonCalendarService) private readonly calendar: SeasonCalendarService) {}

  @Get()
  async list(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query(new ZodValidationPipe(AgendaQuerySchema)) query: z.infer<typeof AgendaQuerySchema>
  ) {
    return SeasonAgendaResponseSchema.parse(await this.calendar.listForAdmin(admin.id, leagueId, query.month));
  }
}
