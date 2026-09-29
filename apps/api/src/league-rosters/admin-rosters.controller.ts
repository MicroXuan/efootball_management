import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import {
  AcquirePlayerRequestSchema,
  EmergencyCorrectRosterRequestSchema,
  RecalculateLeagueSalaryRequestSchema,
  ReleasePlayerRequestSchema,
  TransferPlayerRequestSchema,
  UpgradePlayerCardRequestSchema,
  type AcquirePlayerRequest,
  type EmergencyCorrectRosterRequest,
  type RecalculateLeagueSalaryRequest,
  type ReleasePlayerRequest,
  type TransferPlayerRequest,
  type UpgradePlayerCardRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard, PlatformAdminOnly } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { RosterTransactionsService } from './roster-transactions.service.js';
import { SalaryRecalculationService } from './salary-recalculation.service.js';

@Controller('admin/roster')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminRostersController {
  constructor(
    @Inject(RosterTransactionsService)
    private readonly rosterTransactions: RosterTransactionsService,
    @Inject(SalaryRecalculationService)
    private readonly salaryRecalculation: SalaryRecalculationService
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

  @Post('transfers')
  transfer(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(TransferPlayerRequestSchema)) body: TransferPlayerRequest
  ) {
    return this.rosterTransactions.transfer(body, admin.id);
  }

  @Post('card-upgrades')
  upgradeCard(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(UpgradePlayerCardRequestSchema)) body: UpgradePlayerCardRequest
  ) {
    return this.rosterTransactions.upgradeCard(body, admin.id);
  }

  @Post('salary-recalculations')
  recalculateLeague(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(RecalculateLeagueSalaryRequestSchema))
    body: RecalculateLeagueSalaryRequest
  ) {
    return this.salaryRecalculation.recalculateLeague(body, admin.id);
  }

  @Post('emergency-corrections')
  @PlatformAdminOnly()
  emergencyCorrect(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(EmergencyCorrectRosterRequestSchema))
    body: EmergencyCorrectRosterRequest
  ) {
    return this.rosterTransactions.emergencyCorrect(body, admin.id);
  }
}
