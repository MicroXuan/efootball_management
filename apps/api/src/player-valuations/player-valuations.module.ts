import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminValuationWindowsController } from './admin-valuation-windows.controller.js';
import { MyValuationsController } from './my-valuations.controller.js';
import { ValuationSnapshotsService } from './valuation-snapshots.service.js';
import { ValuationWindowsService } from './valuation-windows.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule],
  controllers: [AdminValuationWindowsController, MyValuationsController],
  providers: [ValuationWindowsService, ValuationSnapshotsService],
  exports: [ValuationWindowsService, ValuationSnapshotsService]
})
export class PlayerValuationsModule {}
