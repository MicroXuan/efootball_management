import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  BatchMutationRequestSchema,
  PlatformPageRequestSchema,
  ResourceIdSchema,
  StartPlatformSyncRequestSchema,
  type BatchMutationRequest,
  type PlatformPageRequest,
  type StartPlatformSyncRequest
} from '@efm/contracts';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard, PlatformAdminOnly } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PlatformDataSyncService } from './platform-data-sync.service.js';

const PlayerRecordPageRequestSchema = PlatformPageRequestSchema.extend({
  diffType: z.enum(['CREATE', 'UPDATE', 'UNCHANGED', 'INVALID']).optional()
});
type PlayerRecordPageRequest = z.infer<typeof PlayerRecordPageRequestSchema>;

@Controller('admin/data-sync')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
@PlatformAdminOnly()
export class PlatformDataSyncController {
  constructor(@Inject(PlatformDataSyncService) private readonly sync: PlatformDataSyncService) {}

  @Get('overview')
  overview(@CurrentAdmin() admin: CurrentAdminIdentity) {
    return this.sync.getOverview(admin.id);
  }

  @Post('players/runs')
  @HttpCode(202)
  startPlayerRun(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(StartPlatformSyncRequestSchema)) body: StartPlatformSyncRequest
  ) { return this.sync.startPlayerRun(admin.id, body); }

  @Get('players/runs')
  listPlayerRuns(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Query(new ZodValidationPipe(PlatformPageRequestSchema)) query: PlatformPageRequest
  ) { return this.sync.listPlayerRuns(admin.id, query); }

  @Get('players/runs/:runId')
  getPlayerRun(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('runId', new ZodValidationPipe(ResourceIdSchema)) runId: string
  ) { return this.sync.getPlayerRun(admin.id, runId); }

  @Post('players/runs/:runId/resume')
  @HttpCode(202)
  resumePlayerRun(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('runId', new ZodValidationPipe(ResourceIdSchema)) runId: string
  ) { return this.sync.resumePlayerRun(admin.id, runId); }

  @Get('players/runs/:runId/batches')
  listPlayerBatches(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('runId', new ZodValidationPipe(ResourceIdSchema)) runId: string,
    @Query(new ZodValidationPipe(PlatformPageRequestSchema)) query: PlatformPageRequest
  ) { return this.sync.listPlayerBatches(admin.id, runId, query); }

  @Get('players/batches/:batchId/records')
  listPlayerRecords(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string,
    @Query(new ZodValidationPipe(PlayerRecordPageRequestSchema)) query: PlayerRecordPageRequest
  ) {
    return this.sync.listPlayerRecords(admin.id, batchId, {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.query === undefined ? {} : { query: query.query }),
      ...(query.diffType === undefined ? {} : { diffType: query.diffType })
    });
  }

  @Post('players/batches/:batchId/publish')
  publishPlayerBatch(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string
  ) { return this.sync.publishPlayerBatch(admin.id, batchId); }

  @Post('players/batches/:batchId/reject')
  rejectPlayerBatch(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string
  ) { return this.sync.rejectPlayerBatch(admin.id, batchId); }

  @Post('teams/runs')
  @HttpCode(202)
  startTeamRun(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(StartPlatformSyncRequestSchema)) body: StartPlatformSyncRequest
  ) { return this.sync.startTeamRun(admin.id, body); }

  @Get('teams/runs')
  listTeamRuns(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Query(new ZodValidationPipe(PlatformPageRequestSchema)) query: PlatformPageRequest
  ) { return this.sync.listTeamRuns(admin.id, query); }

  @Get('teams/runs/:runId')
  getTeamRun(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('runId', new ZodValidationPipe(ResourceIdSchema)) runId: string
  ) { return this.sync.getTeamRun(admin.id, runId); }

  @Post('teams/runs/:runId/resume')
  @HttpCode(202)
  resumeTeamRun(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('runId', new ZodValidationPipe(ResourceIdSchema)) runId: string
  ) { return this.sync.resumeTeamRun(admin.id, runId); }

  @Get('teams/runs/:runId/items')
  listTeamItems(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('runId', new ZodValidationPipe(ResourceIdSchema)) runId: string,
    @Query(new ZodValidationPipe(PlatformPageRequestSchema)) query: PlatformPageRequest
  ) { return this.sync.listTeamItems(admin.id, runId, query); }

  @Post('teams/items/:itemId/publish')
  publishTeamItem(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('itemId', new ZodValidationPipe(ResourceIdSchema)) itemId: string
  ) { return this.sync.publishTeamItems(admin.id, [itemId]); }

  @Post('teams/items/:itemId/reject')
  rejectTeamItem(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('itemId', new ZodValidationPipe(ResourceIdSchema)) itemId: string
  ) { return this.sync.rejectTeamItems(admin.id, [itemId]); }

  @Post('teams/items/publish')
  publishTeamItems(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(BatchMutationRequestSchema)) body: BatchMutationRequest
  ) { return this.sync.publishTeamItems(admin.id, body.ids); }

  @Post('teams/items/reject')
  rejectTeamItems(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(BatchMutationRequestSchema)) body: BatchMutationRequest
  ) { return this.sync.rejectTeamItems(admin.id, body.ids); }

  @Post('teams/items/retry')
  retryTeamItems(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(BatchMutationRequestSchema)) body: BatchMutationRequest
  ) { return this.sync.retryTeamItems(admin.id, body.ids); }
}
