import { Body, Controller, Get, Inject, Post, Query, UseGuards } from '@nestjs/common';
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

@Controller('admin/team-catalog')
@UseGuards(AdminAuthGuard)
export class AdminTeamCatalogController {
  constructor(
    @Inject(TeamCatalogService) private readonly catalog: TeamCatalogService
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
}
