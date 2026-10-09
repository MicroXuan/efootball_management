import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminPlayerAuctionsController } from './admin-player-auctions.controller.js';
import { AdminPlayerAuctionsService } from './admin-player-auctions.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PlayerAuctionBidService } from './player-auction-bid.service.js';
import { PlayerAuctionLockRepository } from './player-auction-lock.repository.js';
import { PlayerAuctionStateService } from './player-auction-state.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule, AuthorizationModule],
  controllers: [AdminPlayerAuctionsController],
  providers: [AdminPlayerAuctionsService, PlayerAuctionBidService, PlayerAuctionLockRepository, PlayerAuctionStateService],
  exports: [AdminPlayerAuctionsService, PlayerAuctionBidService, PlayerAuctionStateService]
})
export class PlayerAuctionsModule {}
