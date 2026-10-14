import { Module } from '@nestjs/common';
import { PlayerMarketAccessService } from './player-market-access.service.js';
import { PlayerMarketQueryService } from './player-market-query.service.js';

@Module({
  providers: [PlayerMarketAccessService, PlayerMarketQueryService],
  exports: [PlayerMarketAccessService, PlayerMarketQueryService]
})
export class PlayerMarketModule {}
