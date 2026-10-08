import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminRulesController } from './admin-rules.controller.js';
import { AdminRostersController } from './admin-rosters.controller.js';
import { RosterLockRepository } from './roster-lock.repository.js';
import { RosterTransactionsService } from './roster-transactions.service.js';
import { SalaryRulesService } from './salary-rules.service.js';
import { SalaryRecalculationService } from './salary-recalculation.service.js';
import { TransferWindowsService } from './transfer-windows.service.js';
import { AdminRosterQueriesService } from './admin-roster-queries.service.js';
import { LeagueEconomyModule } from '../league-economy/league-economy.module.js';
import { PlayerValuationsModule } from '../player-valuations/player-valuations.module.js';
import { PlayerBuildsModule } from '../player-builds/player-builds.module.js';

@Module({
  imports: [AdminAuthModule, AdminModule, LeagueEconomyModule, PlayerValuationsModule, PlayerBuildsModule],
  controllers: [AdminRulesController, AdminRostersController],
  providers: [
    SalaryRulesService,
    TransferWindowsService,
    RosterLockRepository,
    RosterTransactionsService,
    SalaryRecalculationService,
    AdminRosterQueriesService
  ],
  exports: [
    SalaryRulesService,
    TransferWindowsService,
    RosterTransactionsService,
    SalaryRecalculationService
  ]
})
export class LeagueRostersModule {}
