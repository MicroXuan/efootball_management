import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  PublishValuationSubmissionRequestSchema,
  ResourceIdSchema,
  SaveValuationDraftRequestSchema,
  type PublishValuationSubmissionRequest,
  type SaveValuationDraftRequest
} from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ValuationSnapshotsService } from './valuation-snapshots.service.js';
import { ValuationSubmissionsService } from './valuation-submissions.service.js';
import { LeagueError } from '../leagues/league.errors.js';

@Controller('me/league-teams/:teamId/valuations')
@UseGuards(JwtAuthGuard)
export class MyValuationsController {
  constructor(
    @Inject(ValuationSnapshotsService) private readonly snapshots: ValuationSnapshotsService,
    @Inject(ValuationSubmissionsService) private readonly submissions: ValuationSubmissionsService
  ) {}

  @Get('workspace')
  workspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string
  ) {
    return this.snapshots.getWorkspace(user.id, teamId);
  }

  @Patch('draft')
  saveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Body(new ZodValidationPipe(SaveValuationDraftRequestSchema)) body: SaveValuationDraftRequest
  ) {
    return this.submissions.saveDraft(user.id, teamId, body);
  }

  @Post('publish')
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(PublishValuationSubmissionRequestSchema)) body: PublishValuationSubmissionRequest
  ) {
    if (!key?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return this.submissions.publish(user.id, teamId, body, key);
  }
}
