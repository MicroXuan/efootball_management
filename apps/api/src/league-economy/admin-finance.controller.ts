import { Body, Controller, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CreateManualFinanceEntryRequestSchema, ResourceIdSchema, type CreateManualFinanceEntryRequest } from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { TeamFinanceService } from './team-finance.service.js';

@Controller('admin/leagues/:leagueId/finance-entries')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminFinanceController {
  constructor(@Inject(TeamFinanceService) private readonly finance: TeamFinanceService) {}

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateManualFinanceEntryRequestSchema)) body: CreateManualFinanceEntryRequest
  ) {
    if (!key?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return this.finance.createManualEntry(admin.id, leagueId, body, key);
  }
}
