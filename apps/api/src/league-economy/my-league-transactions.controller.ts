import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ResourceIdSchema } from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TransactionFeesService } from './transaction-fees.service.js';
import { z } from 'zod';

const TransactionQuerySchema = z.object({
  cursor: ResourceIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30)
});

@Controller('me/leagues/:leagueId/transactions')
@UseGuards(JwtAuthGuard)
export class MyLeagueTransactionsController {
  constructor(@Inject(TransactionFeesService) private readonly fees: TransactionFeesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query(new ZodValidationPipe(TransactionQuerySchema)) query: z.output<typeof TransactionQuerySchema>
  ) {
    return this.fees.listTransactionsForParticipant(user.id, leagueId, query.cursor, query.limit);
  }
}
