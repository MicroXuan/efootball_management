import { Body, Controller, Get, Headers, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  MyPlayerAuctionListQuerySchema,
  MyPlayerAuctionSaleListQuerySchema,
  PlaceMiniprogramAuctionBidRequestSchema,
  ResourceIdSchema,
  type MyPlayerAuctionListQuery,
  type MyPlayerAuctionSaleListQuery,
  type PlaceMiniprogramAuctionBidRequest
} from '@efm/contracts';
import { CurrentUser, type CurrentUser as AuthenticatedUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PlayerAuctionError } from './player-auction.errors.js';
import { MyPlayerAuctionsService } from './my-player-auctions.service.js';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MyPlayerAuctionsController {
  constructor(@Inject(MyPlayerAuctionsService) private readonly auctions: MyPlayerAuctionsService) {}

  @Get('player-auctions')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(MyPlayerAuctionListQuerySchema)) query: MyPlayerAuctionListQuery
  ) {
    return this.auctions.list(user.id, query);
  }

  @Get('player-auction-sales')
  sales(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(MyPlayerAuctionSaleListQuerySchema)) query: MyPlayerAuctionSaleListQuery
  ) {
    return this.auctions.listSales(user.id, query);
  }

  @Get('player-auctions/:batchId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string
  ) {
    return this.auctions.detail(user.id, batchId);
  }

  @Post('player-auctions/:batchId/bids')
  bid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId', new ZodValidationPipe(ResourceIdSchema)) batchId: string,
    @Body(new ZodValidationPipe(PlaceMiniprogramAuctionBidRequestSchema)) body: PlaceMiniprogramAuctionBidRequest,
    @Headers('idempotency-key') key?: string
  ) {
    if (!key?.trim()) {
      throw new PlayerAuctionError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 Idempotency-Key 请求头', 400);
    }
    return this.auctions.placeBid(user.id, batchId, body, key);
  }
}
