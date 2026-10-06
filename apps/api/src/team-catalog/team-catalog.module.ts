import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminTeamCatalogController } from './admin-team-catalog.controller.js';
import { TeamCatalogService } from './team-catalog.service.js';
import { PesdataSyncModule } from '../pesdata-sync/pesdata-sync.module.js';

@Module({
  imports: [AdminAuthModule, AdminModule, PesdataSyncModule],
  controllers: [AdminTeamCatalogController],
  providers: [TeamCatalogService],
  exports: [TeamCatalogService]
})
export class TeamCatalogModule {}
