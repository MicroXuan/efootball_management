import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  RegisterCompetitionRequestSchema,
  ResourceIdSchema,
  ReviewRegistrationRequestSchema,
  VersionedMutationRequestSchema,
  type RegisterCompetitionRequest,
  type ReviewRegistrationRequest,
  type VersionedMutationRequest
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { RequirePermission } from '../common/auth/roles.decorator.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CompetitionError } from './competition.errors.js';
import { RegistrationsService } from './registrations.service.js';

@Controller()
@UseGuards(JwtAuthGuard, ScopeGuard)
export class RegistrationsController {
  constructor(@Inject(RegistrationsService) private readonly registrations: RegistrationsService) {}

  @Post('competitions/:id/registrations')
  register(@CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(RegisterCompetitionRequestSchema)) body: RegisterCompetitionRequest) {
    return this.registrations.register(user.id, id, body, this.key(key));
  }

  @Delete('competitions/:id/registrations/me')
  @HttpCode(200)
  withdraw(@CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(VersionedMutationRequestSchema)) body: VersionedMutationRequest) {
    return this.registrations.withdraw(user.id, id, body, this.key(key));
  }

  @Get('competitions/:id/registrations/me')
  mine(@CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.registrations.getMine(user.id, id);
  }

  @Get('admin/competitions/:id/registrations')
  @RequirePermission('competition.registration.review', { type: 'COMPETITION', param: 'id' })
  list(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.registrations.listForManager(id);
  }

  @Post('admin/competitions/:id/registrations/:registrationId/approve')
  @HttpCode(200)
  @RequirePermission('competition.registration.review', { type: 'COMPETITION', param: 'id' })
  approve(@CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Param('registrationId', new ZodValidationPipe(ResourceIdSchema)) registrationId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(VersionedMutationRequestSchema)) body: VersionedMutationRequest) {
    return this.registrations.review(user.id, id, registrationId, { ...body, decision: 'APPROVE' }, this.key(key));
  }

  @Post('admin/competitions/:id/registrations/:registrationId/reject')
  @HttpCode(200)
  @RequirePermission('competition.registration.review', { type: 'COMPETITION', param: 'id' })
  reject(@CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Param('registrationId', new ZodValidationPipe(ResourceIdSchema)) registrationId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ReviewRegistrationRequestSchema)) body: ReviewRegistrationRequest) {
    return this.registrations.review(user.id, id, registrationId, { ...body, decision: 'REJECT' }, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) throw new CompetitionError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    return value;
  }
}
