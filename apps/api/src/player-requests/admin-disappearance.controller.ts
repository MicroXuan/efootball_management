import { Body, Controller, Get, Headers, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { DisappearanceRequestStatusSchema, ResourceIdSchema, ReviewDisappearanceRequestSchema, type ReviewDisappearanceRequest } from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { DisappearanceReviewService } from './disappearance-review.service.js';

@Controller('admin/leagues/:leagueId/disappearance-requests')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminDisappearanceController {
  constructor(@Inject(DisappearanceReviewService) private readonly reviews: DisappearanceReviewService) {}

  @Get()
  list(@CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query('status', new ZodValidationPipe(DisappearanceRequestStatusSchema.optional())) status?: string) {
    return this.reviews.list(admin.id, leagueId, status);
  }

  @Post(':id/review')
  review(@CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ReviewDisappearanceRequestSchema)) body: ReviewDisappearanceRequest) {
    if (!key?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return this.reviews.review(admin.id, leagueId, id, body, key);
  }
}
