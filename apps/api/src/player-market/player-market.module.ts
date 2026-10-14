import { Module } from '@nestjs/common';
import { PlayerMarketAccessService } from './player-market-access.service.js';
import { PlayerMarketQueryService } from './player-market-query.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PlayerApplicationService } from './player-application.service.js';
import { PlayerMarketLockRepository } from './player-market-lock.repository.js';
import { AdminModule } from '../admin/admin.module.js';
import { LeagueRostersModule } from '../league-rosters/league-rosters.module.js';
import { PlayerMarketReviewService } from './player-market-review.service.js';

@Module({
  imports: [AdminModule, LeagueRostersModule],
  providers: [MutationReceiptService, PlayerMarketAccessService, PlayerMarketQueryService, PlayerApplicationService, PlayerMarketLockRepository, PlayerMarketReviewService],
  exports: [PlayerMarketAccessService, PlayerMarketQueryService, PlayerApplicationService, PlayerMarketLockRepository, PlayerMarketReviewService]
})
export class PlayerMarketModule {}
