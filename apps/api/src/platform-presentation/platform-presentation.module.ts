import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import {
  AdminPlatformPresentationController,
  PublicPlatformPresentationController,
} from './platform-presentation.controller.js';
import { PlatformPresentationService } from './platform-presentation.service.js';

@Module({
  imports: [AdminAuthModule, AdminModule],
  controllers: [
    PublicPlatformPresentationController,
    AdminPlatformPresentationController,
  ],
  providers: [PlatformPresentationService],
})
export class PlatformPresentationModule {}
