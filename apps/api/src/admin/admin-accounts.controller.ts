import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards
} from '@nestjs/common';
import {
  CreateAdminAccountRequestSchema,
  CreateAdminLeagueGrantRequestSchema,
  ExpectedVersionSchema,
  ResetAdminPasswordRequestSchema,
  ResourceIdSchema,
  UpdateAdminAccountRequestSchema,
  type CreateAdminAccountRequest,
  type CreateAdminLeagueGrantRequest,
  type ResetAdminPasswordRequest,
  type UpdateAdminAccountRequest
} from '@efm/contracts';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { AdminError } from './admin.errors.js';
import { AdminScopeGuard, PlatformAdminOnly } from './admin-scope.guard.js';

const RevokeGrantRequestSchema = z.object({ expectedVersion: ExpectedVersionSchema });

@Controller('admin/accounts')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
@PlatformAdminOnly()
export class AdminAccountsController {
  constructor(@Inject(AdminAccountsService) private readonly accounts: AdminAccountsService) {}

  @Get()
  list() {
    return this.accounts.list();
  }

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateAdminAccountRequestSchema)) body: CreateAdminAccountRequest
  ) {
    return this.accounts.create(admin.id, body, this.key(key));
  }

  @Patch(':adminId')
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('adminId', new ZodValidationPipe(ResourceIdSchema)) adminId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpdateAdminAccountRequestSchema)) body: UpdateAdminAccountRequest
  ) {
    return this.accounts.update(admin.id, adminId, body, this.key(key));
  }

  @Post(':adminId/reset-password')
  @HttpCode(200)
  resetPassword(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('adminId', new ZodValidationPipe(ResourceIdSchema)) adminId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ResetAdminPasswordRequestSchema)) body: ResetAdminPasswordRequest
  ) {
    return this.accounts.resetPassword(admin.id, adminId, body, this.key(key));
  }

  @Post(':adminId/league-grants')
  grantLeague(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('adminId', new ZodValidationPipe(ResourceIdSchema)) adminId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateAdminLeagueGrantRequestSchema)) body: CreateAdminLeagueGrantRequest
  ) {
    return this.accounts.grantLeague(admin.id, adminId, body, this.key(key));
  }

  @Get(':adminId/league-grants')
  listLeagueGrants(
    @Param('adminId', new ZodValidationPipe(ResourceIdSchema)) adminId: string
  ) {
    return this.accounts.listLeagueGrants(adminId);
  }

  @Delete(':adminId/league-grants/:grantId')
  revokeLeague(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('adminId', new ZodValidationPipe(ResourceIdSchema)) adminId: string,
    @Param('grantId', new ZodValidationPipe(ResourceIdSchema)) grantId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(RevokeGrantRequestSchema)) body: z.infer<typeof RevokeGrantRequestSchema>
  ) {
    return this.accounts.revokeLeague(admin.id, adminId, grantId, body.expectedVersion, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new AdminError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
