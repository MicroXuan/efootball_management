import { Global, Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminPlayerAuctionsController } from './admin-player-auctions.controller.js';
import { AdminPlayerAuctionsService } from './admin-player-auctions.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { PlayerAuctionBidService } from './player-auction-bid.service.js';
import { PlayerAuctionLockRepository } from './player-auction-lock.repository.js';
import { PlayerAuctionStateService } from './player-auction-state.service.js';
import { WechatBotModule } from '../wechat-bot/wechat-bot.module.js';
import { PlayerAuctionClock } from './player-auction-clock.js';
import { PlayerAuctionWorker } from './player-auction-worker.js';
import { PlayerAuctionRecoveryService } from './player-auction-recovery.service.js';
import { PLAYER_AUCTION_RECOVERY_HOOK } from './player-auction-recovery.hook.js';

@Global()
@Module({
  imports: [AdminAuthModule, AdminModule, AuthorizationModule, WechatBotModule],
  controllers: [AdminPlayerAuctionsController],
  providers: [
    AdminPlayerAuctionsService,
    PlayerAuctionBidService,
    PlayerAuctionClock,
    PlayerAuctionLockRepository,
    PlayerAuctionRecoveryService,
    PlayerAuctionStateService,
    PlayerAuctionWorker,
    { provide: PLAYER_AUCTION_RECOVERY_HOOK, useExisting: PlayerAuctionRecoveryService }
  ],
  exports: [
    AdminPlayerAuctionsService,
    PlayerAuctionBidService,
    PlayerAuctionRecoveryService,
    PlayerAuctionStateService,
    PLAYER_AUCTION_RECOVERY_HOOK
  ]
})
export class PlayerAuctionsModule {}
