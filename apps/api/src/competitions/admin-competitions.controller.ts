import {
  Body,
  Controller,
  Headers,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards
} from '@nestjs/common';
import {
  CancelCompetitionRequestSchema,
  CreateCompetitionRequestSchema,
  ResourceIdSchema,
  UpdateCompetitionRequestSchema,
  UpdateCompetitionRulesRequestSchema,
  VersionedMutationRequestSchema,
  type ParsedCreateCompetitionRequest,
  type UpdateCompetitionRequest,
  type UpdateCompetitionRulesRequest,
  type VersionedMutationRequest
} from '@efm/contracts';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { RequirePermission } from '../common/auth/roles.decorator.js';
import { ScopeGuard } from '../common/auth/scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CompetitionError } from './competition.errors.js';
import { CompetitionsService } from './competitions.service.js';

type CancelRequest = VersionedMutationRequest & { reason: string };

@Controller('admin/competitions')
@UseGuards(JwtAuthGuard, ScopeGuard)
export class AdminCompetitionsController {
  constructor(@Inject(CompetitionsService) private readonly competitions: CompetitionsService) {}

  @Get(':id')
  @RequirePermission('competition.manage', { type: 'COMPETITION', param: 'id' })
  get(@Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string) {
    return this.competitions.getManaged(id);
  }

  @Post()
  @RequirePermission('competition.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateCompetitionRequestSchema)) body: ParsedCreateCompetitionRequest
  ) {
    return this.competitions.create(user.id, body, this.key(key));
  }

  @Patch(':id')
  @RequirePermission('competition.manage', { type: 'COMPETITION', param: 'id' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpdateCompetitionRequestSchema)) body: UpdateCompetitionRequest
  ) {
    return this.competitions.update(user.id, id, body, this.key(key));
  }

  @Post(':id/rules')
  @HttpCode(200)
  @RequirePermission('competition.manage', { type: 'COMPETITION', param: 'id' })
  rules(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(UpdateCompetitionRulesRequestSchema)) body: UpdateCompetitionRulesRequest
  ) {
    return this.competitions.updateRules(user.id, id, body, this.key(key));
  }

  @Post(':id/open-registration')
  @HttpCode(200)
  @RequirePermission('competition.manage', { type: 'COMPETITION', param: 'id' })
  open(@CurrentUser() user: AuthenticatedUser, @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string, @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(VersionedMutationRequestSchema)) body: VersionedMutationRequest) {
    return this.competitions.transition(user.id, id, 'REGISTRATION_OPEN', body, this.key(key));
  }

  @Post(':id/close-registration')
  @HttpCode(200)
  @RequirePermission('competition.manage', { type: 'COMPETITION', param: 'id' })
  close(@CurrentUser() user: AuthenticatedUser, @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string, @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(VersionedMutationRequestSchema)) body: VersionedMutationRequest) {
    return this.competitions.transition(user.id, id, 'REGISTRATION_CLOSED', body, this.key(key));
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermission('competition.manage', { type: 'COMPETITION', param: 'id' })
  start(@CurrentUser() user: AuthenticatedUser, @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string, @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(VersionedMutationRequestSchema)) body: VersionedMutationRequest) {
    return this.competitions.transition(user.id, id, 'IN_PROGRESS', body, this.key(key));
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('competition.manage', { type: 'COMPETITION', param: 'id' })
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string, @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(VersionedMutationRequestSchema)) body: VersionedMutationRequest) {
    return this.competitions.transition(user.id, id, 'COMPLETED', body, this.key(key));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('competition.manage', { type: 'COMPETITION', param: 'id' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string, @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CancelCompetitionRequestSchema)) body: CancelRequest) {
    return this.competitions.transition(user.id, id, 'CANCELLED', body, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new CompetitionError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
    }
    return value;
  }
}
