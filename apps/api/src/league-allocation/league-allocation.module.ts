import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminLeagueAllocationController } from './admin-league-allocation.controller.js';
import { LeagueAllocationService } from './league-allocation.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule],
  controllers: [AdminLeagueAllocationController],
  providers: [LeagueAllocationService],
  exports: [LeagueAllocationService]
})
export class LeagueAllocationModule {}
