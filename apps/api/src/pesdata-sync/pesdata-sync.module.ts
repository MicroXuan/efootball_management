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

@Module({
  imports: [DatabaseModule, PlayerImportModule, StorageModule],
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
    PesdataSyncService,
    PesdataTeamSyncService
  ],
  exports: [PesdataSyncService, PesdataTeamSyncService]
})
export class PesdataSyncModule {}
