import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateLeagueRequestSchema,
  PublicUserNumberSchema,
  ResourceIdSchema,
  UpdateLeagueRequestSchema,
  type ParsedCreateLeagueRequest,
  type UpdateLeagueRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator.js';
import type { CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminError } from './admin.errors.js';
import { AdminLeaguesService } from './admin-leagues.service.js';
import { AdminScopeGuard, PlatformAdminOnly } from './admin-scope.guard.js';
import { AdminUserLookupService } from './admin-user-lookup.service.js';

@Controller('admin/platform/leagues')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
@PlatformAdminOnly()
export class AdminLeaguesController {
  constructor(@Inject(AdminLeaguesService) private readonly leagues: AdminLeaguesService) {}

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateLeagueRequestSchema)) body: ParsedCreateLeagueRequest
  ) {
    return this.leagues.create(admin.id, body, this.key(key));
  }

  @Patch(':leagueId')
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpdateLeagueRequestSchema)) body: UpdateLeagueRequest
  ) {
    return this.leagues.update(admin.id, leagueId, body, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new AdminError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}

@Controller('admin/leagues/:leagueId/users')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminLeagueUsersController {
  constructor(@Inject(AdminUserLookupService) private readonly users: AdminUserLookupService) {}

  @Get(':publicUserNo')
  get(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) _leagueId: string,
    @Param('publicUserNo', new ZodValidationPipe(PublicUserNumberSchema)) publicUserNo: string
  ) {
    return this.users.findExact(admin.id, publicUserNo);
  }
}
