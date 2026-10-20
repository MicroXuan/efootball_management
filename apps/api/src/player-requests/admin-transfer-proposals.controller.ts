import { Body, Controller, Get, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ResourceIdSchema, ReviewTransferProposalSchema, type ReviewTransferProposal } from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { TransferReviewService } from './transfer-review.service.js';

@Controller('admin/leagues/:leagueId/transfer-proposals')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminTransferProposalsController {
  constructor(@Inject(TransferReviewService) private readonly proposals: TransferReviewService) {}

  @Get()
  list(@CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string) {
    return this.proposals.list(admin.id, leagueId);
  }

  @Post(':id/review')
  review(@CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ReviewTransferProposalSchema)) body: ReviewTransferProposal) {
    if (!key?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return this.proposals.review(admin.id, leagueId, id, body, key);
  }
}
