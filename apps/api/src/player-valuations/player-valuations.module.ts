import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminValuationWindowsController } from './admin-valuation-windows.controller.js';
import { ValuationWindowsService } from './valuation-windows.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule],
  controllers: [AdminValuationWindowsController],
  providers: [ValuationWindowsService],
  exports: [ValuationWindowsService]
})
export class PlayerValuationsModule {}
