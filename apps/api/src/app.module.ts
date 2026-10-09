import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';
import { AdminModule } from './admin/admin.module.js';
import { configuration } from './config/configuration.js';
import { validateEnvironment } from './config/env.schema.js';
import { CompetitionsModule } from './competitions/competitions.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LeaguesModule } from './leagues/leagues.module.js';
import { LeagueTeamsModule } from './league-teams/league-teams.module.js';
import { LeagueRostersModule } from './league-rosters/league-rosters.module.js';
import { LeagueEconomyModule } from './league-economy/league-economy.module.js';
import { LeagueAllocationModule } from './league-allocation/league-allocation.module.js';
import { LeagueWorkspaceModule } from './league-workspace/league-workspace.module.js';
import { LeagueVisibilityModule } from './league-visibility/league-visibility.module.js';
import { LeagueTeamLifecycleModule } from './league-team-lifecycle/league-team-lifecycle.module.js';
import { PlayerCatalogModule } from './player-catalog/player-catalog.module.js';
import { PlayerFavoritesModule } from './player-favorites/player-favorites.module.js';
import { PlayerImportModule } from './player-import/player-import.module.js';
import { PlatformPresentationModule } from './platform-presentation/platform-presentation.module.js';
import { PlatformDataSyncModule } from './platform-data-sync/platform-data-sync.module.js';
import { PlayerValuationsModule } from './player-valuations/player-valuations.module.js';
import { PlayerBuildsModule } from './player-builds/player-builds.module.js';
import { PesdataSyncModule } from './pesdata-sync/pesdata-sync.module.js';
import { UsersModule } from './users/users.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TeamCatalogModule } from './team-catalog/team-catalog.module.js';
import { WechatBotModule } from './wechat-bot/wechat-bot.module.js';
import { PlayerAuctionsModule } from './player-auctions/player-auctions.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      validate: validateEnvironment
    }),
    AdminAuthModule,
    AdminModule,
    AuthModule,
    CompetitionsModule,
    DatabaseModule,
    LeagueVisibilityModule,
    LeagueTeamLifecycleModule,
    HealthModule,
    LeaguesModule,
    LeagueTeamsModule,
    LeagueRostersModule,
    LeagueEconomyModule,
    LeagueAllocationModule,
    LeagueWorkspaceModule,
    PlayerCatalogModule,
    PlayerFavoritesModule,
    PlayerBuildsModule,
    PlayerAuctionsModule,
    PlayerImportModule,
    PlatformDataSyncModule,
    PlatformPresentationModule,
    PlayerValuationsModule,
    PesdataSyncModule,
    StorageModule,
    TeamCatalogModule,
    UsersModule,
    WechatBotModule
  ]
})
export class AppModule {}
