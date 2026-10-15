import { Module } from '@nestjs/common';
import { PlayerMarketAccessService } from './player-market-access.service.js';
import { PlayerMarketQueryService } from './player-market-query.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PlayerApplicationService } from './player-application.service.js';
import { PlayerMarketLockRepository } from './player-market-lock.repository.js';
import { AdminModule } from '../admin/admin.module.js';
import { LeagueRostersModule } from '../league-rosters/league-rosters.module.js';
import { PlayerMarketReviewService } from './player-market-review.service.js';
import { TeamPlayerReleaseService } from './team-player-release.service.js';
import { MyPlayerMarketController } from './my-player-market.controller.js';
import { AdminPlayerMarketController } from './admin-player-market.controller.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';

@Module({
  imports: [AuthorizationModule, AdminAuthModule, AdminModule, LeagueRostersModule],
  controllers: [MyPlayerMarketController, AdminPlayerMarketController],
  providers: [MutationReceiptService, PlayerMarketAccessService, PlayerMarketQueryService, PlayerApplicationService, PlayerMarketLockRepository, PlayerMarketReviewService, TeamPlayerReleaseService],
  exports: [PlayerMarketAccessService, PlayerMarketQueryService, PlayerApplicationService, PlayerMarketLockRepository, PlayerMarketReviewService, TeamPlayerReleaseService]
})
export class PlayerMarketModule {}
