import { Module } from '@nestjs/common';
import { PlayerMarketModule } from '../player-market/player-market.module.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { DisappearanceService } from './disappearance.service.js';
import { MyDisappearanceSubmitController, MyPlayerRequestsController } from './my-player-requests.controller.js';

@Module({
  imports: [PlayerMarketModule],
  controllers: [MyPlayerRequestsController, MyDisappearanceSubmitController],
  providers: [DisappearanceService, MutationReceiptService],
  exports: [DisappearanceService]
})
export class PlayerRequestsModule {}
