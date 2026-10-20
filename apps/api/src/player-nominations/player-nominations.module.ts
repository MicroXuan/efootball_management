import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminNominationCandidatesController, AdminNominationController } from './admin-nomination.controller.js';
import { NominationWindowService } from './nomination-window.service.js';
import { MyNominationWindowsController, MyNominationsController } from './my-nominations.controller.js';
import { NominationService } from './nomination.service.js';
import { PlayerMarketModule } from '../player-market/player-market.module.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule, PlayerMarketModule],
  controllers: [AdminNominationController, AdminNominationCandidatesController, MyNominationWindowsController, MyNominationsController],
  providers: [NominationWindowService, NominationService, MutationReceiptService],
  exports: [NominationWindowService, NominationService]
})
export class PlayerNominationsModule {}
