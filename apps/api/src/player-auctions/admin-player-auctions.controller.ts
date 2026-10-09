import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  CancelPlayerAuctionBatchRequestSchema,
  CreatePlayerAuctionBatchRequestSchema,
  PreparePlayerAuctionBatchRequestSchema,
  ReplacePlayerAuctionLotsRequestSchema,
  ResourceIdSchema,
  ReviewPlayerAuctionLotRequestSchema,
  UpdatePlayerAuctionBatchRequestSchema,
  type CancelPlayerAuctionBatchRequest,
  type CreatePlayerAuctionBatchRequest,
  type PreparePlayerAuctionBatchRequest,
  type ReplacePlayerAuctionLotsRequest,
  type ReviewPlayerAuctionLotRequest,
  type UpdatePlayerAuctionBatchRequest
} from '@efm/contracts';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { CurrentAdmin, type CurrentAdminIdentity } from '../admin-auth/current-admin.decorator.js';
import { AdminScopeGuard } from '../admin/admin-scope.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { AdminPlayerAuctionsService } from './admin-player-auctions.service.js';
import { PlayerAuctionError } from './player-auction.errors.js';

@Controller('admin/leagues/:leagueId/player-auctions')
@UseGuards(AdminAuthGuard, AdminScopeGuard)
export class AdminPlayerAuctionsController {
  constructor(@Inject(AdminPlayerAuctionsService) private readonly service: AdminPlayerAuctionsService) {}

  @Get()
  list(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string
  ) {
    return this.service.list(admin.id, leagueId);
  }

  @Get(':batchId')
  detail(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string
  ) {
    return this.service.detail(admin.id, leagueId, batchId);
  }

  @Post()
  create(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Body(new ZodValidationPipe(CreatePlayerAuctionBatchRequestSchema)) body: CreatePlayerAuctionBatchRequest,
    @Headers('idempotency-key') key?: string
  ) {
    return this.service.create(admin.id, leagueId, body, this.key(key));
  }

  @Patch(':batchId')
  update(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string,
    @Body(new ZodValidationPipe(UpdatePlayerAuctionBatchRequestSchema)) body: UpdatePlayerAuctionBatchRequest,
    @Headers('idempotency-key') key?: string
  ) {
    return this.service.update(admin.id, leagueId, batchId, body, this.key(key));
  }

  @Put(':batchId/lots')
  replaceLots(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string,
    @Body(new ZodValidationPipe(ReplacePlayerAuctionLotsRequestSchema)) body: ReplacePlayerAuctionLotsRequest,
    @Headers('idempotency-key') key?: string
  ) {
    return this.service.replaceLots(admin.id, leagueId, batchId, body, this.key(key));
  }

  @Post(':batchId/prepare')
  prepare(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string,
    @Body(new ZodValidationPipe(PreparePlayerAuctionBatchRequestSchema)) body: PreparePlayerAuctionBatchRequest,
    @Headers('idempotency-key') key?: string
  ) {
    return this.service.prepare(admin.id, leagueId, batchId, body, this.key(key));
  }

  @Post(':batchId/cancel')
  cancel(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string,
    @Body(new ZodValidationPipe(CancelPlayerAuctionBatchRequestSchema)) body: CancelPlayerAuctionBatchRequest,
    @Headers('idempotency-key') key?: string
  ) {
    return this.service.cancel(admin.id, leagueId, batchId, body, this.key(key));
  }

  @Post(':batchId/lots/:lotId/review')
  review(
    @CurrentAdmin() admin: CurrentAdminIdentity,
    @Param('leagueId', new ZodValidationPipe(ResourceIdSchema)) leagueId: string,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string,
    @Param('lotId', new ZodValidationPipe(ResourceIdSchema)) lotId: string,
    @Body(new ZodValidationPipe(ReviewPlayerAuctionLotRequestSchema)) body: ReviewPlayerAuctionLotRequest,
    @Headers('idempotency-key') key?: string
  ) {
    return this.service.reviewLot(admin.id, leagueId, batchId, lotId, body, this.key(key));
  }

  private key(value?: string) {
    if (!value?.trim()) throw new PlayerAuctionError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    return value;
  }
}
