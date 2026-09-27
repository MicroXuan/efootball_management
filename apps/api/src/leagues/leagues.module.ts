import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CompetitionsModule } from '../competitions/competitions.module.js';
import { OptionalJwtAuthGuard } from '../common/auth/optional-jwt-auth.guard.js';
import { AdminLeaguesController } from './admin-leagues.controller.js';
import { AdminSeasonEntriesController } from './admin-season-entries.controller.js';
import { LeaguesService } from './leagues.service.js';
import { PublicLeaguesController } from './public-leagues.controller.js';
import { SeasonEntriesController } from './season-entries.controller.js';
import { SeasonEntriesService } from './season-entries.service.js';
import { AdminSeasonsController, PublicSeasonsController } from './seasons.controller.js';
import { SeasonsService } from './seasons.service.js';
import { TeamProfilesController } from './team-profiles.controller.js';
import { TeamProfilesService } from './team-profiles.service.js';

@Module({
  imports: [AuthorizationModule, CompetitionsModule, JwtModule.register({})],
  controllers: [
    TeamProfilesController,
    PublicLeaguesController,
    AdminLeaguesController,
    SeasonEntriesController,
    AdminSeasonEntriesController,
    PublicSeasonsController,
    AdminSeasonsController
  ],
  providers: [OptionalJwtAuthGuard, TeamProfilesService, LeaguesService, SeasonsService, SeasonEntriesService],
  exports: [TeamProfilesService, LeaguesService, SeasonsService, SeasonEntriesService]
})
export class LeaguesModule {}
