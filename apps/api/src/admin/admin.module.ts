import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminAccountsController } from './admin-accounts.controller.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuthorizationService } from './admin-authorization.service.js';
import { AdminLeaguesController, AdminLeagueUsersController } from './admin-leagues.controller.js';
import { AdminLeaguesService } from './admin-leagues.service.js';
import { AdminLeagueSeasonsController } from './admin-league-seasons.controller.js';
import { AdminLeagueSeasonsService } from './admin-league-seasons.service.js';
import { AdminMutationReceiptService } from './admin-mutation-receipt.service.js';
import { AdminScopeGuard } from './admin-scope.guard.js';
import {
  ADMIN_LOOKUP_RATE_LIMITER,
  AdminUserLookupService,
  InMemoryAdminLookupRateLimiter
} from './admin-user-lookup.service.js';
import { AuditLogService } from './audit-log.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [
    AdminAccountsController,
    AdminAuditController,
    AdminLeaguesController,
    AdminLeagueUsersController,
    AdminLeagueSeasonsController
  ],
  providers: [
    AdminAccountsService,
    AdminAuthorizationService,
    AdminLeaguesService,
    AdminLeagueSeasonsService,
    AdminMutationReceiptService,
    AdminScopeGuard,
    AdminUserLookupService,
    AuditLogService,
    InMemoryAdminLookupRateLimiter,
    {
      provide: ADMIN_LOOKUP_RATE_LIMITER,
      useExisting: InMemoryAdminLookupRateLimiter
    }
  ],
  exports: [AdminAuthorizationService, AdminMutationReceiptService, AdminScopeGuard, AuditLogService]
})
export class AdminModule {}
