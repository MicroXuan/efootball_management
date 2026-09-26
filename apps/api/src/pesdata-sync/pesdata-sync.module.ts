import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { PlayerImportModule } from '../player-import/player-import.module.js';
import { PesdataClient, type PesdataClientConfig } from './pesdata-client.js';
import { PESDATA_SYNC_OPTIONS, PesdataSyncService } from './pesdata-sync.service.js';

@Module({
  imports: [DatabaseModule, PlayerImportModule],
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
    { provide: PESDATA_SYNC_OPTIONS, useValue: {} },
    PesdataSyncService
  ],
  exports: [PesdataSyncService]
})
export class PesdataSyncModule {}
