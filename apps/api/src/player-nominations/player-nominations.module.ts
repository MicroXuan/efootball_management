import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AdminNominationController } from './admin-nomination.controller.js';
import { NominationWindowService } from './nomination-window.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule],
  controllers: [AdminNominationController],
  providers: [NominationWindowService],
  exports: [NominationWindowService]
})
export class PlayerNominationsModule {}
