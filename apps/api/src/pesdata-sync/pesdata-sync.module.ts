import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { PlayerImportModule } from '../player-import/player-import.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/object-storage.js';
import { PesdataClient, type PesdataClientConfig } from './pesdata-client.js';
import { PesdataCrestLoader } from './pesdata-crest-loader.js';
import { PESDATA_SYNC_OPTIONS, PesdataSyncService } from './pesdata-sync.service.js';
import { PESDATA_TEAM_SYNC_OPTIONS, PesdataTeamSyncService } from './pesdata-team-sync.service.js';
import { AdminModule } from '../admin/admin.module.js';
import { PesdataPlayerChunkProcessor } from './pesdata-player-chunk.processor.js';
import { PesdataTeamChunkProcessor } from './pesdata-team-chunk.processor.js';
import { PlayerCatalogScanRepository } from './player-catalog-scan.repository.js';
import { PesdataPlayerReconciliationProcessor, PESDATA_RECONCILIATION_OPTIONS } from './pesdata-player-reconciliation.processor.js';
import { PlayerCatalogScheduleService } from './player-catalog-schedule.service.js';
import { PlayerCatalogReconciliationReview } from './player-catalog-reconciliation.review.js';

@Module({
  imports: [AdminModule, DatabaseModule, PlayerImportModule, StorageModule],
  providers: [
    {
      provide: PesdataClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const signatureSeed = config.get<string>('PESDATA_SIGNATURE_SEED');
        const clientConfig: PesdataClientConfig = {
          baseUrl: config.get<string>('PESDATA_BASE_URL') ?? 'https://pesdata.net',
          siteVersion: config.get<string>('PESDATA_SITE_VERSION') ?? '1.9.0',
          requestsPerSecond: config.get<number>('PESDATA_REQUESTS_PER_SECOND') ?? 1,
          timeoutMs: config.get<number>('PESDATA_TIMEOUT_MS') ?? 15_000,
          maxRetries: config.get<number>('PESDATA_MAX_RETRIES') ?? 5,
          ...(signatureSeed ? { signatureSeed } : {})
        };
        return new PesdataClient(clientConfig);
      }
    },
    {
      provide: PesdataCrestLoader,
      inject: [OBJECT_STORAGE],
      useFactory: (storage: ObjectStorage) => new PesdataCrestLoader(storage)
    },
    { provide: PESDATA_SYNC_OPTIONS, useValue: {} },
    { provide: PESDATA_TEAM_SYNC_OPTIONS, useValue: {} },
    { provide: PESDATA_RECONCILIATION_OPTIONS, inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const value = Number(config.get<string>('PESDATA_MAX_MISSING_PERCENT') ?? '20');
        return { maxMissingPercent: Number.isFinite(value) && value >= 0 && value <= 100 ? value : 20 };
      } },
    PesdataSyncService,
    PesdataPlayerChunkProcessor,
    PlayerCatalogScanRepository,
    PesdataPlayerReconciliationProcessor,
    PlayerCatalogScheduleService,
    PlayerCatalogReconciliationReview,
    PesdataTeamChunkProcessor,
    PesdataTeamSyncService
  ],
  exports: [PesdataSyncService, PesdataPlayerChunkProcessor, PesdataPlayerReconciliationProcessor,
    PlayerCatalogScheduleService, PlayerCatalogReconciliationReview,
    PesdataTeamSyncService, PesdataTeamChunkProcessor]
})
export class PesdataSyncModule {}
