import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ResourceIdSchema, SeasonAgendaMonthSchema, SeasonAgendaResponseSchema } from '@efm/contracts';
import { z } from 'zod';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { SeasonCalendarService } from './season-calendar.service.js';

const AgendaQuerySchema = z.object({ month: SeasonAgendaMonthSchema });

@Controller('me/leagues/:leagueId/seasons/:seasonId/agenda')
@UseGuards(JwtAuthGuard)
export class SeasonCalendarController {
  constructor(@Inject(SeasonCalendarService) private readonly calendar: SeasonCalendarService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Query(new ZodValidationPipe(AgendaQuerySchema)) query: z.infer<typeof AgendaQuerySchema>
  ) {
    return SeasonAgendaResponseSchema.parse(await this.calendar.list(user.id, leagueId, seasonId, query.month));
  }
}
