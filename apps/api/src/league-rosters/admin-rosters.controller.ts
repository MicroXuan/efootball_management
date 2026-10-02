import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AcquirePlayerRequestSchema,
  EmergencyCorrectRosterRequestSchema,
  RecalculateLeagueSalaryRequestSchema,
  ReleasePlayerRequestSchema,
  TransferPlayerRequestSchema,
  UpgradePlayerCardRequestSchema,
  UpdateRosterLifecycleRequestSchema,
  ResourceIdSchema,
  type AcquirePlayerRequest,
  type EmergencyCorrectRosterRequest,
  type RecalculateLeagueSalaryRequest,
  type ReleasePlayerRequest,
  type TransferPlayerRequest,
  type UpdateRosterLifecycleRequest,
  type UpgradePlayerCardRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard, PlatformAdminOnly } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { RosterTransactionsService } from './roster-transactions.service.js';
import { SalaryRecalculationService } from './salary-recalculation.service.js';
import { AdminRosterQueriesService } from './admin-roster-queries.service.js';
import { z } from 'zod';

const RosterQuerySchema = z.object({ seasonId: ResourceIdSchema });
const CandidateQuerySchema = z.object({ keyword: z.string().trim().min(1).max(80) });
const LedgerQuerySchema = z.object({ teamId: ResourceIdSchema.optional() });

@Controller('admin/roster')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminRostersController {
  constructor(
    @Inject(RosterTransactionsService)
    private readonly rosterTransactions: RosterTransactionsService,
    @Inject(SalaryRecalculationService)
    private readonly salaryRecalculation: SalaryRecalculationService,
    @Inject(AdminRosterQueriesService) private readonly queries: AdminRosterQueriesService
  ) {}

  @Get('leagues/:leagueId/teams/:teamId/roster')
  roster(
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string,
    @Query(new ZodValidationPipe(RosterQuerySchema)) query: z.output<typeof RosterQuerySchema>
  ) {
    return this.queries.roster(leagueId, teamId, query.seasonId);
  }

  @Get('leagues/:leagueId/player-candidates')
  candidates(
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query(new ZodValidationPipe(CandidateQuerySchema)) query: z.output<typeof CandidateQuerySchema>
  ) {
    return this.queries.candidates(leagueId, query.keyword);
  }

  @Get('leagues/:leagueId/ledger')
  ledger(
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Query(new ZodValidationPipe(LedgerQuerySchema)) query: z.output<typeof LedgerQuerySchema>
  ) {
    return this.queries.ledger(leagueId, query.teamId);
  }

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

  @Post('lifecycle-status')
  updateLifecycleStatus(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(UpdateRosterLifecycleRequestSchema))
    body: UpdateRosterLifecycleRequest
  ) {
    return this.rosterTransactions.updateLifecycleStatus(body, admin.id);
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
