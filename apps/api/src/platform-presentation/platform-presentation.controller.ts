import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  UpdatePlatformPresentationRequestSchema,
  type UpdatePlatformPresentationRequest,
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import {
  CurrentAdmin,
  type CurrentAdminIdentity,
} from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard, PlatformAdminOnly } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PlatformPresentationService } from './platform-presentation.service.js';

@Controller('platform-presentation')
export class PublicPlatformPresentationController {
  constructor(
    @Inject(PlatformPresentationService)
    private readonly presentation: PlatformPresentationService,
  ) {}

  @Get()
  get() {
    return this.presentation.get();
  }
}

@Controller('admin/platform/presentation')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
@PlatformAdminOnly()
export class AdminPlatformPresentationController {
  constructor(
    @Inject(PlatformPresentationService)
    private readonly presentation: PlatformPresentationService,
  ) {}

  @Get()
  get() {
    return this.presentation.get();
  }

  @Patch()
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Body(new ZodValidationPipe(UpdatePlatformPresentationRequestSchema))
    body: UpdatePlatformPresentationRequest,
  ) {
    return this.presentation.update(admin.id, body);
  }
}
