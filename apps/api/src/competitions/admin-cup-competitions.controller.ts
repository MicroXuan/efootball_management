import { Body, Controller, Headers, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  CreateSeasonCupRequestSchema,
  ConfirmCupGroupProposalRequestSchema,
  GenerateCupGroupProposalRequestSchema,
  ConfirmCupBracketProposalRequestSchema,
  GenerateCupBracketProposalRequestSchema,
  ResourceIdSchema,
  type ConfirmCupGroupProposalRequest,
  type GenerateCupGroupProposalRequest,
  type ConfirmCupBracketProposalRequest,
  type GenerateCupBracketProposalRequest,
  type ParsedCreateSeasonCupRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CompetitionError } from './competition.errors.js';
import { CupCompetitionsService } from './cup-competitions.service.js';
import { CupGroupsService } from './cup-groups.service.js';
import { CupBracketsService } from './cup-brackets.service.js';

@Controller('admin/leagues/:leagueId/seasons/:seasonId/cups')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminCupCompetitionsController {
  constructor(
    @Inject(CupCompetitionsService) private readonly cups: CupCompetitionsService,
    @Inject(CupGroupsService) private readonly groups: CupGroupsService,
    @Inject(CupBracketsService) private readonly brackets: CupBracketsService
  ) {}

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateSeasonCupRequestSchema)) body: ParsedCreateSeasonCupRequest
  ) {
    if (!key?.trim()) {
      throw new CompetitionError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    }
    return this.cups.create(admin.id, leagueId, seasonId, body, key);
  }

  @Post(':competitionId/group-proposals')
  generateGroups(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('competitionId', new ZodValidationPipe(ResourceIdSchema)) competitionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(GenerateCupGroupProposalRequestSchema)) body: GenerateCupGroupProposalRequest
  ) {
    return this.groups.generate(admin.id, leagueId, competitionId, body, this.key(key));
  }

  @Post(':competitionId/group-decisions')
  confirmGroups(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('competitionId', new ZodValidationPipe(ResourceIdSchema)) competitionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ConfirmCupGroupProposalRequestSchema)) body: ConfirmCupGroupProposalRequest
  ) {
    return this.groups.confirm(admin.id, leagueId, competitionId, body, this.key(key));
  }

  @Post(':competitionId/bracket-proposals')
  generateBracket(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('competitionId', new ZodValidationPipe(ResourceIdSchema)) competitionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(GenerateCupBracketProposalRequestSchema)) body: GenerateCupBracketProposalRequest
  ) {
    return this.brackets.generate(admin.id, leagueId, competitionId, body, this.key(key));
  }

  @Post(':competitionId/bracket-decisions')
  confirmBracket(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('competitionId', new ZodValidationPipe(ResourceIdSchema)) competitionId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(ConfirmCupBracketProposalRequestSchema)) body: ConfirmCupBracketProposalRequest
  ) {
    return this.brackets.confirm(admin.id, leagueId, competitionId, body, this.key(key));
  }

  private key(value: string | undefined): string {
    if (!value?.trim()) {
      throw new CompetitionError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    }
    return value;
  }
}
