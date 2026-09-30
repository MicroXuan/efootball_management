import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ResourceIdSchema } from '@efm/contracts';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminScopeGuard, PlatformAdminOnly } from './admin-scope.guard.js';
import { AuditLogService } from './audit-log.service.js';

const AuditQuerySchema = z.object({ leagueId: ResourceIdSchema.optional() });

@Controller('admin/audit-logs')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
@PlatformAdminOnly()
export class AdminAuditController {
  constructor(@Inject(AuditLogService) private readonly audit: AuditLogService) {}

  @Get()
  list(@Query(new ZodValidationPipe(AuditQuerySchema)) query: z.infer<typeof AuditQuerySchema>) {
    return this.audit.list(query.leagueId);
  }
}
