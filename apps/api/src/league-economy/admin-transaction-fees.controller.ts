import { Body, Controller, Get, Headers, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CreateTransactionFeeRuleRequestSchema, ResourceIdSchema, type CreateTransactionFeeRuleRequest } from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { TransactionFeesService } from './transaction-fees.service.js';
import { z } from 'zod';

const TransactionQuerySchema = z.object({
  cursor: ResourceIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30)
});

@Controller('admin/leagues/:leagueId')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminTransactionFeesController {
  constructor(@Inject(TransactionFeesService) private readonly fees: TransactionFeesService) {}

  @Get('transaction-fee-rules')
  rules(@Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string) {
    return this.fees.listRuleVersions(leagueId);
  }

  @Post('transaction-fee-rules')
  createRule(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateTransactionFeeRuleRequestSchema)) body: CreateTransactionFeeRuleRequest
  ) {
    if (!key?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return this.fees.createRuleVersion(admin.id, leagueId, body, key);
  }

  @Get('transactions')
  transactions(
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query(new ZodValidationPipe(TransactionQuerySchema)) query: z.output<typeof TransactionQuerySchema>
  ) {
    return this.fees.listTransactions(leagueId, query.cursor, query.limit);
  }
}
