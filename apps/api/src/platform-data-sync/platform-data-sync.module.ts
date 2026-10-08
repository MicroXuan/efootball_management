import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { PesdataSyncModule } from '../pesdata-sync/pesdata-sync.module.js';
import { PlayerImportModule } from '../player-import/player-import.module.js';
import { TeamCatalogModule } from '../team-catalog/team-catalog.module.js';
import { PlatformDataSyncController } from './platform-data-sync.controller.js';
import { PlatformDataSyncRunner } from './platform-data-sync.runner.js';
import { PlatformDataSyncService } from './platform-data-sync.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule, PesdataSyncModule, PlayerImportModule, TeamCatalogModule],
  controllers: [PlatformDataSyncController],
  providers: [PlatformDataSyncRunner, PlatformDataSyncService]
})
export class PlatformDataSyncModule {}
