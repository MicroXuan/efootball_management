import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CompetitionsModule } from '../competitions/competitions.module.js';
import { AdminLeaguesController } from './admin-leagues.controller.js';
import { LeaguesService } from './leagues.service.js';
import { PublicLeaguesController } from './public-leagues.controller.js';
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
    PublicSeasonsController,
    AdminSeasonsController
  ],
  providers: [TeamProfilesService, LeaguesService, SeasonsService],
  exports: [TeamProfilesService, LeaguesService, SeasonsService]
})
export class LeaguesModule {}
