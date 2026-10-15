import { Body, Controller, Get, Headers, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PlayerApplicationListQuerySchema, ResourceIdSchema, ReviewPlayerApplicationRequestSchema, type PlayerApplicationListQuery, type ReviewPlayerApplicationRequest } from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PlayerMarketQueryService } from './player-market-query.service.js';
import { PlayerMarketReviewService } from './player-market-review.service.js';
import { playerMarketError } from './player-market.errors.js';

@Controller('admin')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminPlayerMarketController {
  constructor(
    @Inject(PlayerMarketReviewService) private readonly reviews: PlayerMarketReviewService,
    @Inject(PlayerMarketQueryService) private readonly queries: PlayerMarketQueryService
  ) {}

  @Get('leagues/:leagueId/player-market-applications')
  applications(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Query(new ZodValidationPipe(PlayerApplicationListQuerySchema)) query: PlayerApplicationListQuery) {
    return this.queries.listApplicationsForAdmin(admin.id, leagueId, query);
  }

  @Post('player-market-applications/:applicationId/approve')
  approve(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('applicationId', new ZodValidationPipe(ResourceIdSchema)) applicationId: string, @Body(new ZodValidationPipe(ReviewPlayerApplicationRequestSchema)) body: ReviewPlayerApplicationRequest, @Headers('idempotency-key') key?: string) {
    return this.reviews.approve(admin.id, applicationId, body, this.key(key));
  }

  @Post('player-market-applications/:applicationId/reject')
  reject(@CurrentAdmin() admin: CurrentAdminIdentity, @Param('applicationId', new ZodValidationPipe(ResourceIdSchema)) applicationId: string, @Body(new ZodValidationPipe(ReviewPlayerApplicationRequestSchema)) body: ReviewPlayerApplicationRequest, @Headers('idempotency-key') key?: string) {
    return this.reviews.reject(admin.id, applicationId, body, this.key(key));
  }

  private key(value?: string): string {
    if (!value?.trim()) throw playerMarketError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return value;
  }
}
