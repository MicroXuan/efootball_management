import { Module } from '@nestjs/common';
import { PlayerMarketModule } from '../player-market/player-market.module.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { DisappearanceService } from './disappearance.service.js';
import { MyDisappearanceSubmitController, MyPlayerRequestsController } from './my-player-requests.controller.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { LeagueRostersModule } from '../league-rosters/league-rosters.module.js';
import { AdminDisappearanceController } from './admin-disappearance.controller.js';
import { DisappearanceReviewService } from './disappearance-review.service.js';
import { TransferProposalService } from './transfer-proposal.service.js';
import { MyTransferCandidatesController, MyTransferProposalsController } from './my-transfer-proposals.controller.js';

@Module({
  imports: [PlayerMarketModule, AdminAuthModule, AdminModule, LeagueRostersModule],
  controllers: [MyPlayerRequestsController, MyDisappearanceSubmitController, AdminDisappearanceController, MyTransferProposalsController, MyTransferCandidatesController],
  providers: [DisappearanceService, DisappearanceReviewService, TransferProposalService, MutationReceiptService],
  exports: [DisappearanceService]
})
export class PlayerRequestsModule {}
