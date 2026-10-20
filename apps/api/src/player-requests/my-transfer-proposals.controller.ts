import { Body, Controller, Get, Headers, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ResourceIdSchema, RespondTransferProposalSchema, SubmitTransferProposalSchema, type RespondTransferProposal, type SubmitTransferProposal } from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LeagueError } from '../leagues/league.errors.js';
import { TransferProposalService } from './transfer-proposal.service.js';

@Controller('me/transfer-proposals')
@UseGuards(JwtAuthGuard)
export class MyTransferProposalsController {
  constructor(@Inject(TransferProposalService) private readonly proposals: TransferProposalService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string) {
    return this.proposals.listMine(user.id, seasonId);
  }

  @Post()
  submit(@CurrentUser() user: AuthenticatedUser, @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(SubmitTransferProposalSchema)) body: SubmitTransferProposal) {
    return this.proposals.submit(user.id, body, this.key(key));
  }

  @Post(':id/respond')
  respond(@CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(ResourceIdSchema)) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(RespondTransferProposalSchema)) body: RespondTransferProposal) {
    return this.proposals.respond(user.id, id, body, this.key(key));
  }

  private key(value: string | undefined) {
    if (!value?.trim()) throw new LeagueError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return value;
  }
}

@Controller('me/leagues/:leagueId/transfer-candidates')
@UseGuards(JwtAuthGuard)
export class MyTransferCandidatesController {
  constructor(@Inject(TransferProposalService) private readonly proposals: TransferProposalService) {}

  @Get(':playerId')
  candidate(@CurrentUser() user: AuthenticatedUser,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('playerId', new ZodValidationPipe(ResourceIdSchema)) playerId: string,
    @Query('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string) {
    return this.proposals.candidate(user.id, leagueId, seasonId, playerId);
  }
}
