import { Global, Module } from '@nestjs/common';
import { LeagueTeamLifecycleService } from './league-team-lifecycle.service.js';

@Global()
@Module({
  providers: [LeagueTeamLifecycleService],
  exports: [LeagueTeamLifecycleService]
})
export class LeagueTeamLifecycleModule {}
