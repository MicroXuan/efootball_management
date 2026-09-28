import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import {
  AcquirePlayerRequestSchema,
  ReleasePlayerRequestSchema,
  type AcquirePlayerRequest,
  type ReleasePlayerRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { RosterTransactionsService } from './roster-transactions.service.js';

@Controller('admin/roster')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminRostersController {
  constructor(
    @Inject(RosterTransactionsService)
    private readonly rosterTransactions: RosterTransactionsService
  ) {}

  @Post('acquisitions')
  acquire(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(AcquirePlayerRequestSchema)) body: AcquirePlayerRequest
  ) {
    return this.rosterTransactions.acquire(body, admin.id);
  }

  @Post('releases')
  release(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(ReleasePlayerRequestSchema)) body: ReleasePlayerRequest
  ) {
    return this.rosterTransactions.release(body, admin.id);
  }
}
