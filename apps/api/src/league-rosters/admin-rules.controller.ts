import { Body, Controller, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateSalaryRuleVersionRequestSchema,
  CreateTransferWindowRequestSchema,
  PreviewSalaryRuleRequestSchema,
  ResourceIdSchema,
  UpdateTransferWindowRequestSchema,
  type CreateSalaryRuleVersionRequest,
  type CreateTransferWindowRequest,
  type PreviewSalaryRuleRequest,
  type UpdateTransferWindowRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { SalaryRulesService } from './salary-rules.service.js';
import { TransferWindowsService } from './transfer-windows.service.js';

@Controller('admin')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminRulesController {
  constructor(
    @Inject(SalaryRulesService) private readonly salaryRules: SalaryRulesService,
    @Inject(TransferWindowsService) private readonly transferWindows: TransferWindowsService
  ) {}

  @Post('leagues/:leagueId/salary-rules')
  createSalaryRule(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Body(new ZodValidationPipe(CreateSalaryRuleVersionRequestSchema))
    body: CreateSalaryRuleVersionRequest
  ) {
    return this.salaryRules.createVersion(admin.id, leagueId, body);
  }

  @Post('leagues/:leagueId/salary-rules/preview')
  previewSalaryRule(
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Body(new ZodValidationPipe(PreviewSalaryRuleRequestSchema)) body: PreviewSalaryRuleRequest
  ) {
    return this.salaryRules.previewRecalculation(leagueId, body);
  }

  @Post('seasons/:seasonId/transfer-windows')
  createTransferWindow(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Body(new ZodValidationPipe(CreateTransferWindowRequestSchema)) body: CreateTransferWindowRequest
  ) {
    return this.transferWindows.create(admin.id, seasonId, body);
  }

  @Patch('transfer-windows/:windowId')
  updateTransferWindow(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('windowId', new ZodValidationPipe(ResourceIdSchema)) windowId: string,
    @Body(new ZodValidationPipe(UpdateTransferWindowRequestSchema)) body: UpdateTransferWindowRequest
  ) {
    return this.transferWindows.update(admin.id, windowId, body);
  }
}
