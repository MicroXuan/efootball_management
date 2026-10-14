import { Module } from '@nestjs/common';
import { PlayerMarketAccessService } from './player-market-access.service.js';
import { PlayerMarketQueryService } from './player-market-query.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PlayerApplicationService } from './player-application.service.js';
import { PlayerMarketLockRepository } from './player-market-lock.repository.js';

@Module({
  providers: [MutationReceiptService, PlayerMarketAccessService, PlayerMarketQueryService, PlayerApplicationService, PlayerMarketLockRepository],
  exports: [PlayerMarketAccessService, PlayerMarketQueryService, PlayerApplicationService, PlayerMarketLockRepository]
})
export class PlayerMarketModule {}
