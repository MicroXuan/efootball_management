import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MyTeamAssetsController } from './my-team-assets.controller.js';
import { TeamAssetsService } from './team-assets.service.js';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminTransactionFeesController } from './admin-transaction-fees.controller.js';
import { MyLeagueTransactionsController } from './my-league-transactions.controller.js';
import { TransactionFeesService } from './transaction-fees.service.js';

@Module({
  imports: [JwtModule.register({}), AdminAuthModule, AdminModule],
  controllers: [MyTeamAssetsController, MyLeagueTransactionsController, AdminTransactionFeesController],
  providers: [TeamAssetsService, TransactionFeesService],
  exports: [TeamAssetsService, TransactionFeesService]
})
export class LeagueEconomyModule {}
