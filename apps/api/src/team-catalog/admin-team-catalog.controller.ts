import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateCustomTeamCatalogItemRequestSchema,
  ResourceIdSchema,
  type CreateCustomTeamCatalogItemRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TeamCatalogService } from './team-catalog.service.js';
import { PesdataTeamSyncService } from '../pesdata-sync/pesdata-team-sync.service.js';
import { z } from 'zod';

const StartTeamSyncSchema = z.object({
  mode: z.enum(['sample', 'full', 'incremental']),
  limit: z.number().int().min(1).max(5_000).optional()
});

@Controller('admin/team-catalog')
@UseGuards(AdminAuthGuard)
export class AdminTeamCatalogController {
  constructor(
    @Inject(TeamCatalogService) private readonly catalog: TeamCatalogService,
    @Inject(PesdataTeamSyncService) private readonly sync: PesdataTeamSyncService
  ) {}

  @Get()
  list(
    @Query('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query('keyword') keyword?: string,
    @Query('sourceLeagueName') sourceLeagueName?: string,
    @Query('includeDisabled') includeDisabled?: string
  ) {
    return this.catalog.listAvailable(leagueId, {
      ...(keyword ? { keyword } : {}),
      ...(sourceLeagueName ? { sourceLeagueName } : {}),
      includeDisabled: includeDisabled === 'true'
    });
  }

  @Post('custom')
  createCustom(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(CreateCustomTeamCatalogItemRequestSchema)) body: CreateCustomTeamCatalogItemRequest
  ) {
    return this.catalog.createCustom(admin.id, body);
  }

  @Get('sync-runs')
  listSyncRuns() { return this.catalog.listSyncRuns(); }

  @Post('sync-runs')
  startSync(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(StartTeamSyncSchema)) body: z.infer<typeof StartTeamSyncSchema>
  ) { return this.sync.start(admin.id, { mode: body.mode, ...(body.limit === undefined ? {} : { limit: body.limit }) }); }

  @Post('sync-runs/:runId/resume')
  resumeSync(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('runId', new ZodValidationPipe(ResourceIdSchema)) runId: string
  ) { return this.sync.resume(admin.id, runId); }

  @Get('sync-runs/:runId/items')
  listSyncItems(@Param('runId', new ZodValidationPipe(ResourceIdSchema)) runId: string) {
    return this.catalog.listSyncDifferences(runId);
  }

  @Post('sync-items/:itemId/publish')
  publishSyncItem(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('itemId', new ZodValidationPipe(ResourceIdSchema)) itemId: string
  ) { return this.catalog.publishSyncItem(admin.id, itemId); }

  @Post('sync-items/:itemId/reject')
  rejectSyncItem(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('itemId', new ZodValidationPipe(ResourceIdSchema)) itemId: string
  ) { return this.catalog.rejectSyncItem(admin.id, itemId); }
}
