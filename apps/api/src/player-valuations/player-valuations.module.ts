import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminValuationWindowsController } from './admin-valuation-windows.controller.js';
import { AdminValuationReviewsController } from './admin-valuation-reviews.controller.js';
import { CompetitionsModule } from '../competitions/competitions.module.js';
import { MyValuationsController } from './my-valuations.controller.js';
import { ValuationSnapshotsService } from './valuation-snapshots.service.js';
import { ValuationSubmissionsService } from './valuation-submissions.service.js';
import { ValuationWindowsService } from './valuation-windows.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule, CompetitionsModule],
  controllers: [AdminValuationWindowsController, AdminValuationReviewsController, MyValuationsController],
  providers: [ValuationWindowsService, ValuationSnapshotsService, ValuationSubmissionsService],
  exports: [ValuationWindowsService, ValuationSnapshotsService, ValuationSubmissionsService]
})
export class PlayerValuationsModule {}
