import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CompetitionsModule } from '../competitions/competitions.module.js';
import { AdminLeaguesController } from './admin-leagues.controller.js';
import { LeaguesService } from './leagues.service.js';
import { PublicLeaguesController } from './public-leagues.controller.js';
import { TeamProfilesController } from './team-profiles.controller.js';
import { TeamProfilesService } from './team-profiles.service.js';

@Module({
  imports: [AuthorizationModule, CompetitionsModule, JwtModule.register({})],
  controllers: [TeamProfilesController, PublicLeaguesController, AdminLeaguesController],
  providers: [TeamProfilesService, LeaguesService],
  exports: [TeamProfilesService, LeaguesService]
})
export class LeaguesModule {}
