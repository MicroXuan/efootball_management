import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminRulesController } from './admin-rules.controller.js';
import { SalaryRulesService } from './salary-rules.service.js';
import { TransferWindowsService } from './transfer-windows.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule],
  controllers: [AdminRulesController],
  providers: [SalaryRulesService, TransferWindowsService],
  exports: [SalaryRulesService, TransferWindowsService]
})
export class LeagueRostersModule {}
