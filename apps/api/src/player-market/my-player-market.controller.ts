import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  AmendPlayerApplicationRequestSchema,
  PlayerApplicationListQuerySchema,
  PlayerMarketAnnouncementQuerySchema,
  PlayerMarketQuerySchema,
  ReleaseOwnedPlayerRequestSchema,
  ResourceIdSchema,
  SubmitPlayerApplicationRequestSchema,
  WithdrawPlayerApplicationRequestSchema,
  type AmendPlayerApplicationRequest,
  type PlayerApplicationListQuery,
  type PlayerMarketAnnouncementQuery,
  type PlayerMarketQuery,
  type ReleaseOwnedPlayerRequest,
  type SubmitPlayerApplicationRequest,
  type WithdrawPlayerApplicationRequest
} from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PlayerApplicationService } from './player-application.service.js';
import { PlayerMarketQueryService } from './player-market-query.service.js';
import { TeamPlayerReleaseService } from './team-player-release.service.js';
import { playerMarketError } from './player-market.errors.js';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MyPlayerMarketController {
  constructor(
    @Inject(PlayerMarketQueryService) private readonly queries: PlayerMarketQueryService,
    @Inject(PlayerApplicationService) private readonly applications: PlayerApplicationService,
    @Inject(TeamPlayerReleaseService) private readonly releases: TeamPlayerReleaseService
  ) {}

  @Get('leagues/:leagueId/player-market')
  market(@CurrentUser() user: AuthenticatedUser, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Query(new ZodValidationPipe(PlayerMarketQuerySchema)) query: PlayerMarketQuery) {
    return this.queries.listMarket(user.id, leagueId, query);
  }

  @Get('leagues/:leagueId/player-market/:playerId')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Param('playerId', new ZodValidationPipe(ResourceIdSchema)) playerId: string, @Query('seasonId', new ZodValidationPipe(ResourceIdSchema)) seasonId: string) {
    return this.queries.detail(user.id, leagueId, playerId, seasonId);
  }

  @Get('leagues/:leagueId/player-market-applications')
  listApplications(@CurrentUser() user: AuthenticatedUser, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Query(new ZodValidationPipe(PlayerApplicationListQuerySchema)) query: PlayerApplicationListQuery) {
    return this.queries.listApplications(user.id, leagueId, query);
  }

  @Get('leagues/:leagueId/player-market-announcements')
  announcements(@CurrentUser() user: AuthenticatedUser, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Query(new ZodValidationPipe(PlayerMarketAnnouncementQuerySchema)) query: PlayerMarketAnnouncementQuery) {
    return this.queries.listAnnouncements(user.id, leagueId, query);
  }

  @Post('leagues/:leagueId/player-market-applications')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string, @Body(new ZodValidationPipe(SubmitPlayerApplicationRequestSchema)) body: SubmitPlayerApplicationRequest, @Headers('idempotency-key') key?: string) {
    return this.applications.submit(user.id, leagueId, body, this.key(key));
  }

  @Patch('player-market-applications/:applicationId')
  amend(@CurrentUser() user: AuthenticatedUser, @Param('applicationId', new ZodValidationPipe(ResourceIdSchema)) applicationId: string, @Body(new ZodValidationPipe(AmendPlayerApplicationRequestSchema)) body: AmendPlayerApplicationRequest, @Headers('idempotency-key') key?: string) {
    return this.applications.amend(user.id, applicationId, body, this.key(key));
  }

  @Post('player-market-applications/:applicationId/withdraw')
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('applicationId', new ZodValidationPipe(ResourceIdSchema)) applicationId: string, @Body(new ZodValidationPipe(WithdrawPlayerApplicationRequestSchema)) body: WithdrawPlayerApplicationRequest, @Headers('idempotency-key') key?: string) {
    return this.applications.withdraw(user.id, applicationId, body, this.key(key));
  }

  @Post('league-teams/:teamId/roster/:ownershipId/release')
  release(@CurrentUser() user: AuthenticatedUser, @Param('teamId', new ZodValidationPipe(ResourceIdSchema)) teamId: string, @Param('ownershipId', new ZodValidationPipe(ResourceIdSchema)) ownershipId: string, @Body(new ZodValidationPipe(ReleaseOwnedPlayerRequestSchema)) body: ReleaseOwnedPlayerRequest, @Headers('idempotency-key') key?: string) {
    if (body.ownershipId !== ownershipId) throw playerMarketError('OWNERSHIP_SCOPE_MISMATCH', '路径与请求中的球员归属不一致', 400);
    return this.releases.release(user.id, teamId, body, this.key(key));
  }

  private key(value?: string): string {
    if (!value?.trim()) throw playerMarketError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return value;
  }
}
