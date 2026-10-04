import { Body, Controller, Get, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  ResourceIdSchema,
  ReviewValuationSubmissionRequestSchema,
  type ReviewValuationSubmissionRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminError } from '../admin/admin.errors.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ValuationSubmissionsService } from './valuation-submissions.service.js';

@Controller('admin')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminValuationReviewsController {
  constructor(@Inject(ValuationSubmissionsService) private readonly submissions: ValuationSubmissionsService) {}

  @Get('leagues/:leagueId/valuation-submissions')
  list(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string
  ) {
    return this.submissions.listForLeague(admin.id, leagueId);
  }

  @Post('valuation-submissions/:submissionId/approve')
  approve(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('submissionId', new ZodValidationPipe(ResourceIdSchema)) submissionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ReviewValuationSubmissionRequestSchema)) body: ReviewValuationSubmissionRequest
  ) {
    return this.submissions.approve(admin.id, submissionId, body, this.key(key));
  }

  @Post('valuation-submissions/:submissionId/reject')
  reject(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('submissionId', new ZodValidationPipe(ResourceIdSchema)) submissionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ReviewValuationSubmissionRequestSchema)) body: ReviewValuationSubmissionRequest
  ) {
    return this.submissions.reject(admin.id, submissionId, body, this.key(key));
  }

  private key(value: string | undefined) {
    if (!value?.trim()) throw new AdminError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return value;
  }
}
