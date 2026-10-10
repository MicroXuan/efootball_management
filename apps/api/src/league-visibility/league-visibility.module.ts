import { Global, Module } from '@nestjs/common';
import { LeagueVisibilityService } from './league-visibility.service.js';

@Global()
@Module({
  providers: [LeagueVisibilityService],
  exports: [LeagueVisibilityService]
})
export class LeagueVisibilityModule {}
