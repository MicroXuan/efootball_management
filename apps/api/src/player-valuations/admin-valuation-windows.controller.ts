import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateValuationWindowRequestSchema,
  ResourceIdSchema,
  UpdateValuationWindowRequestSchema,
  type CreateValuationWindowRequest,
  type UpdateValuationWindowRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminError } from '../admin/admin.errors.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ValuationWindowsService } from './valuation-windows.service.js';

@Controller('admin')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminValuationWindowsController {
  constructor(@Inject(ValuationWindowsService) private readonly windows: ValuationWindowsService) {}

  @Get('seasons/:seasonId/valuation-windows')
  list(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string
  ) {
    return this.windows.listForSeason(admin.id, seasonId);
  }

  @Post('seasons/:seasonId/valuation-windows')
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateValuationWindowRequestSchema)) body: CreateValuationWindowRequest
  ) {
    return this.windows.create(admin.id, seasonId, body, this.key(key));
  }

  @Patch('valuation-windows/:windowId')
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('windowId', new ZodValidationPipe(ResourceIdSchema)) windowId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpdateValuationWindowRequestSchema)) body: UpdateValuationWindowRequest
  ) {
    return this.windows.update(admin.id, windowId, body, this.key(key));
  }

  private key(value: string | undefined) {
    if (!value?.trim()) {
      throw new AdminError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    }
    return value;
  }
}
