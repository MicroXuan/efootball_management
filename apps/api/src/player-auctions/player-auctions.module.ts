import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminPlayerAuctionsController } from './admin-player-auctions.controller.js';
import { AdminPlayerAuctionsService } from './admin-player-auctions.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule],
  controllers: [AdminPlayerAuctionsController],
  providers: [AdminPlayerAuctionsService],
  exports: [AdminPlayerAuctionsService]
})
export class PlayerAuctionsModule {}
