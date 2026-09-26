import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { configuration } from './config/configuration.js';
import { validateEnvironment } from './config/env.schema.js';
import { CompetitionsModule } from './competitions/competitions.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LeaguesModule } from './leagues/leagues.module.js';
import { PlayerCatalogModule } from './player-catalog/player-catalog.module.js';
import { PlayerImportModule } from './player-import/player-import.module.js';
import { PesdataSyncModule } from './pesdata-sync/pesdata-sync.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      validate: validateEnvironment
    }),
    AuthModule,
    CompetitionsModule,
    DatabaseModule,
    HealthModule,
    LeaguesModule,
    PlayerCatalogModule,
    PlayerImportModule,
    PesdataSyncModule,
    UsersModule
  ]
})
export class AppModule {}
