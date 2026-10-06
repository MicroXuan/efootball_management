import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminLeagueTeamsController } from './admin-league-teams.controller.js';
import { LeagueTeamsService } from './league-teams.service.js';
import { LeagueTeamShellsService } from './league-team-shells.service.js';
import { MyLeagueTeamsController } from './my-league-teams.controller.js';

@Module({
  imports: [AdminAuthModule, AdminModule],
  controllers: [AdminLeagueTeamsController, MyLeagueTeamsController],
  providers: [LeagueTeamsService, LeagueTeamShellsService],
  exports: [LeagueTeamsService, LeagueTeamShellsService]
})
export class LeagueTeamsModule {}
