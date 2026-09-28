import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminRulesController } from './admin-rules.controller.js';
import { AdminRostersController } from './admin-rosters.controller.js';
import { RosterLockRepository } from './roster-lock.repository.js';
import { RosterTransactionsService } from './roster-transactions.service.js';
import { SalaryRulesService } from './salary-rules.service.js';
import { TransferWindowsService } from './transfer-windows.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule],
  controllers: [AdminRulesController, AdminRostersController],
  providers: [
    SalaryRulesService,
    TransferWindowsService,
    RosterLockRepository,
    RosterTransactionsService
  ],
  exports: [SalaryRulesService, TransferWindowsService, RosterTransactionsService]
})
export class LeagueRostersModule {}
