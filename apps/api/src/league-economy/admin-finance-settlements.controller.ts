import { Body, Controller, Get, Headers, Inject, Param, Put, Query, UseGuards } from '@nestjs/common';
import {
  ResourceIdSchema,
  UpsertTeamFinanceSettlementRequestSchema,
  type UpsertTeamFinanceSettlementRequest
} from '@efm/contracts';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { TeamFinanceService } from './team-finance.service.js';

const SettlementQuerySchema = z.object({
  leagueTeamId: ResourceIdSchema,
  seasonId: ResourceIdSchema
});

@Controller('admin/leagues/:leagueId/finance-settlements')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminFinanceSettlementsController {
  constructor(@Inject(TeamFinanceService) private readonly finance: TeamFinanceService) {}

  @Get()
  get(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query(new ZodValidationPipe(SettlementQuerySchema)) query: z.output<typeof SettlementQuerySchema>
  ) {
    return this.finance.getSettlementSummary(admin.id, leagueId, query.leagueTeamId, query.seasonId);
  }

  @Put()
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpsertTeamFinanceSettlementRequestSchema)) body: UpsertTeamFinanceSettlementRequest
  ) {
    if (!key?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return this.finance.upsertSettlement(admin.id, leagueId, body, key);
  }
}
