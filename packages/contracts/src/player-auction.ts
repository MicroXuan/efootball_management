import { z } from 'zod';
import { ExpectedVersionSchema, ResourceIdSchema } from './common.js';
import { PlayerCardTypeSchema, PlayerPositionSchema } from './player-catalog.js';

const TimestampSchema = z.iso.datetime();
const PositiveMoneySchema = z.number().int().positive().max(2_147_483_647);
const NullableTimestampSchema = TimestampSchema.nullable();

export const PlayerAuctionBidChannelSchema = z.enum(['WECHAT_GROUP', 'MINIPROGRAM']);

export const PlayerAuctionBatchStatusSchema = z.enum([
  'DRAFT',
  'READY',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
  'RECOVERY_REQUIRED'
]);

export const PlayerAuctionLotStatusSchema = z.enum([
  'QUEUED',
  'ACTIVE',
  'PAUSED',
  'PENDING_REVIEW',
  'REVIEWED',
  'VOID',
  'NO_BID'
]);

export const PlayerAuctionBidResultSchema = z.enum([
  'VALID',
  'BELOW_STARTING_PRICE',
  'BELOW_MINIMUM_INCREMENT',
  'UNBOUND',
  'NO_ACTIVE_TEAM',
  'WRONG_LEAGUE',
  'INACTIVE',
  'PAUSED',
  'RECOVERY_REQUIRED',
  'DEADLINE_PASSED',
  'DUPLICATE',
  'OVERFLOW'
]);

export const PlayerAuctionReviewDecisionSchema = z.enum(['CONFIRM', 'ADJUST', 'VOID']);

export const CreatePlayerAuctionBatchRequestSchema = z.object({
  groupBindingId: ResourceIdSchema.nullable().optional(),
  name: z.string().trim().min(1).max(128),
  bidChannel: PlayerAuctionBidChannelSchema.default('WECHAT_GROUP'),
  expectedVersion: ExpectedVersionSchema.optional()
}).superRefine((value, context) => {
  if (value.bidChannel !== 'WECHAT_GROUP') return;
  if (!value.groupBindingId) {
    context.addIssue({ code: 'custom', path: ['groupBindingId'], message: 'WeChat auctions require a group binding' });
  }
  if (value.expectedVersion === undefined) {
    context.addIssue({ code: 'custom', path: ['expectedVersion'], message: 'WeChat auctions require the group version' });
  }
});

export const UpdatePlayerAuctionBatchRequestSchema = z.object({
  name: z.string().trim().min(1).max(128),
  bidChannel: PlayerAuctionBidChannelSchema.optional(),
  groupBindingId: ResourceIdSchema.nullable().optional(),
  groupBindingVersion: ExpectedVersionSchema.optional(),
  expectedVersion: ExpectedVersionSchema
});

export const PlayerAuctionTransitionRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema
});

export const PlayerAuctionLotInputSchema = z.object({
  playerId: ResourceIdSchema,
  playerCardId: ResourceIdSchema,
  nominationId: ResourceIdSchema.optional(),
  displayOrder: z.number().int().positive().max(10_000),
  startingPrice: PositiveMoneySchema,
  minimumIncrement: PositiveMoneySchema
});

export const ReplacePlayerAuctionLotsRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  lots: z.array(PlayerAuctionLotInputSchema).min(1).max(500)
}).superRefine((value, context) => {
  const orders = value.lots.map((lot) => lot.displayOrder);
  if (new Set(orders).size !== orders.length) {
    context.addIssue({ code: 'custom', path: ['lots'], message: 'displayOrder must be unique' });
  }
  const sorted = [...orders].sort((left, right) => left - right);
  if (sorted.some((order, index) => order !== index + 1)) {
    context.addIssue({ code: 'custom', path: ['lots'], message: 'displayOrder must be contiguous from 1' });
  }
});

export const PreparePlayerAuctionBatchRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema
});

export const CancelPlayerAuctionBatchRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  reason: z.string().trim().min(1).max(512)
});

export const ReviewPlayerAuctionLotRequestSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('CONFIRM'),
    expectedVersion: ExpectedVersionSchema,
    reviewedTeamId: z.never().optional(),
    reviewedPrice: z.never().optional(),
    reason: z.string().trim().min(1).max(512).optional()
  }),
  z.object({
    decision: z.literal('ADJUST'),
    expectedVersion: ExpectedVersionSchema,
    reviewedTeamId: ResourceIdSchema,
    reviewedPrice: PositiveMoneySchema,
    reason: z.string().trim().min(1).max(512)
  }),
  z.object({
    decision: z.literal('VOID'),
    expectedVersion: ExpectedVersionSchema,
    reviewedTeamId: z.never().optional(),
    reviewedPrice: z.never().optional(),
    reason: z.string().trim().min(1).max(512)
  })
]);

export const PlayerAuctionBidSchema = z.object({
  id: ResourceIdSchema,
  leagueTeamId: ResourceIdSchema.nullable(),
  teamNumber: z.number().int().min(0).max(9_999).nullable().default(null),
  teamName: z.string().trim().min(1).max(128).nullable(),
  userId: ResourceIdSchema.nullable(),
  bidderDisplayName: z.string().trim().min(1).max(32).nullable().default(null),
  source: PlayerAuctionBidChannelSchema,
  amount: PositiveMoneySchema,
  result: PlayerAuctionBidResultSchema,
  rejectionReason: z.string().max(512).nullable(),
  wechatMessageId: z.string().trim().min(1).max(256).nullable(),
  wechatSortKey: z.string().trim().min(1).max(128).nullable(),
  wechatSentAt: NullableTimestampSchema,
  submittedAt: TimestampSchema,
  receivedAt: TimestampSchema
});

export const PlaceMiniprogramAuctionBidRequestSchema = z.object({
  amount: PositiveMoneySchema,
  lotId: ResourceIdSchema,
  deadlineEpoch: z.number().int().min(0)
});

export const MyPlayerAuctionListQuerySchema = z.object({
  status: z.enum(['active', 'all']).default('active')
});

export const MyPlayerAuctionListItemSchema = z.object({
  batchId: ResourceIdSchema,
  league: z.object({ id: ResourceIdSchema, name: z.string().trim().min(1).max(64) }),
  team: z.object({ id: ResourceIdSchema, name: z.string().trim().min(1).max(128) }),
  name: z.string().trim().min(1).max(128),
  status: PlayerAuctionBatchStatusSchema,
  currentLotId: ResourceIdSchema.nullable(),
  currentPlayerName: z.string().trim().min(1).max(128).nullable(),
  deadlineAt: NullableTimestampSchema,
  sharePath: z.string().startsWith('/pages/auction-room/index?batchId=')
});

export const MyPlayerAuctionPublicBidSchema = z.object({
  id: ResourceIdSchema,
  teamNumber: z.number().int().min(0).max(9_999).nullable(),
  teamName: z.string().trim().min(1).max(128),
  bidderDisplayName: z.string().trim().min(1).max(32),
  amount: PositiveMoneySchema,
  submittedAt: TimestampSchema
});

export const AuctionPlayerCardSnapshotSchema = z.object({
  id: ResourceIdSchema,
  imageUrl: z.string().url().nullable(),
  cardName: z.string().max(128),
  position: PlayerPositionSchema,
  overallRating: z.number().int().min(1).max(110),
  cardType: PlayerCardTypeSchema
});

export const MyPlayerAuctionLotSummarySchema = z.object({
  id: ResourceIdSchema,
  displayOrder: z.number().int().positive(),
  playerName: z.string().trim().min(1).max(128),
  playerSnapshot: z.record(z.string(), z.unknown()),
  card: AuctionPlayerCardSnapshotSchema,
  startingPrice: PositiveMoneySchema,
  minimumIncrement: PositiveMoneySchema,
  status: PlayerAuctionLotStatusSchema,
  currentPrice: PositiveMoneySchema.nullable(),
  winner: z.object({
    teamNumber: z.number().int().min(0).max(9_999).nullable(),
    teamName: z.string().trim().min(1).max(128),
    bidderDisplayName: z.string().trim().min(1).max(32),
    price: PositiveMoneySchema
  }).nullable(),
  deadlineAt: NullableTimestampSchema,
  deadlineEpoch: z.number().int().min(0),
  bids: z.array(MyPlayerAuctionPublicBidSchema)
});

export const MyPlayerAuctionRoomSchema = z.object({
  batchId: ResourceIdSchema,
  name: z.string().trim().min(1).max(128),
  status: PlayerAuctionBatchStatusSchema,
  bidChannel: z.literal('MINIPROGRAM'),
  serverNow: TimestampSchema,
  league: z.object({ id: ResourceIdSchema, name: z.string().trim().min(1).max(64) }),
  team: z.object({ id: ResourceIdSchema, name: z.string().trim().min(1).max(128) }).nullable(),
  canBid: z.boolean(),
  minimumValidPrice: PositiveMoneySchema.nullable(),
  currentLot: MyPlayerAuctionLotSummarySchema.nullable(),
  queue: z.array(MyPlayerAuctionLotSummarySchema.omit({ bids: true })),
  sharePath: z.string().startsWith('/pages/auction-room/index?batchId=')
});

export const MyPlayerAuctionSaleListQuerySchema = z.object({
  keyword: z.string().trim().min(1).max(80).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export const MyPlayerAuctionSaleSchema = z.object({
  id: ResourceIdSchema,
  batchId: ResourceIdSchema,
  league: z.object({
    id: ResourceIdSchema,
    name: z.string().trim().min(1).max(64)
  }),
  player: z.object({
    id: ResourceIdSchema,
    cardId: ResourceIdSchema,
    name: z.string().trim().min(1).max(128),
    imageUrl: z.string().url().nullable(),
    position: PlayerPositionSchema,
    overallRating: z.number().int().min(1).max(110),
    cardType: PlayerCardTypeSchema
  }),
  winner: z.object({
    teamId: ResourceIdSchema,
    teamNumber: z.number().int().min(0).max(9_999).nullable(),
    teamName: z.string().trim().min(1).max(64),
    bidderDisplayName: z.string().trim().min(1).max(32)
  }),
  price: PositiveMoneySchema,
  confirmedAt: TimestampSchema
});

export const MyPlayerAuctionSaleListResponseSchema = z.object({
  items: z.array(MyPlayerAuctionSaleSchema),
  nextCursor: z.string().nullable()
});

export const PlayerAuctionReviewSchema = z.object({
  id: ResourceIdSchema,
  decision: PlayerAuctionReviewDecisionSchema,
  computedWinnerTeamId: ResourceIdSchema.nullable(),
  computedWinnerTeamName: z.string().trim().min(1).max(128).nullable(),
  computedPrice: PositiveMoneySchema.nullable(),
  reviewedWinnerTeamId: ResourceIdSchema.nullable(),
  reviewedWinnerTeamNumber: z.number().int().min(0).max(9_999).nullable().default(null),
  reviewedWinnerTeamName: z.string().trim().min(1).max(128).nullable(),
  reviewedWinnerDisplayName: z.string().trim().min(1).max(32).nullable().default(null),
  reviewedPrice: PositiveMoneySchema.nullable(),
  reason: z.string().max(512).nullable(),
  reviewedByAdminId: ResourceIdSchema,
  reviewedAt: TimestampSchema
});

export const PlayerAuctionLotSchema = z.object({
  id: ResourceIdSchema,
  displayOrder: z.number().int().positive(),
  playerId: ResourceIdSchema,
  playerCardId: ResourceIdSchema.nullable(),
  nominationId: ResourceIdSchema.nullable().default(null),
  noBidAward: z.object({
    leagueTeamId: ResourceIdSchema,
    teamNumber: z.number().int().min(0).max(9_999).nullable(),
    teamName: z.string(),
    ownerAlias: z.string(),
    price: PositiveMoneySchema
  }).nullable().default(null),
  playerName: z.string().trim().min(1).max(128),
  playerSnapshot: z.record(z.string(), z.unknown()),
  startingPrice: PositiveMoneySchema,
  minimumIncrement: PositiveMoneySchema,
  status: PlayerAuctionLotStatusSchema,
  currentPrice: PositiveMoneySchema.nullable(),
  currentHighestBidId: ResourceIdSchema.nullable(),
  deadlineAt: NullableTimestampSchema,
  deadlineEpoch: z.number().int().min(0),
  pausedRemainingMs: z.number().int().min(0).nullable(),
  version: ExpectedVersionSchema,
  bids: z.array(PlayerAuctionBidSchema),
  review: PlayerAuctionReviewSchema.nullable(),
  startedAt: NullableTimestampSchema,
  closedAt: NullableTimestampSchema,
  reviewedAt: NullableTimestampSchema
});

export const PlayerAuctionBatchListItemSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  groupBindingId: ResourceIdSchema.nullable(),
  bidChannel: PlayerAuctionBidChannelSchema,
  groupDisplayName: z.string().trim().min(1).max(128).nullable(),
  name: z.string().trim().min(1).max(128),
  status: PlayerAuctionBatchStatusSchema,
  lotCount: z.number().int().min(0),
  currentLotId: ResourceIdSchema.nullable(),
  version: ExpectedVersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const PlayerAuctionBatchListResponseSchema = z.object({
  items: z.array(PlayerAuctionBatchListItemSchema)
});

export const PlayerAuctionBatchDetailSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  groupBindingId: ResourceIdSchema.nullable(),
  bidChannel: PlayerAuctionBidChannelSchema,
  name: z.string().trim().min(1).max(128),
  status: PlayerAuctionBatchStatusSchema,
  currentLotId: ResourceIdSchema.nullable(),
  version: ExpectedVersionSchema,
  startedAt: NullableTimestampSchema,
  completedAt: NullableTimestampSchema,
  cancelledAt: NullableTimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lots: z.array(PlayerAuctionLotSchema)
});

export function formatAuctionMoney(value: number): string {
  const parsed = PositiveMoneySchema.parse(value);
  return `⭐${parsed}⭐`;
}

export type PlayerAuctionBatchStatus = z.infer<typeof PlayerAuctionBatchStatusSchema>;
export type PlayerAuctionLotStatus = z.infer<typeof PlayerAuctionLotStatusSchema>;
export type PlayerAuctionBidResult = z.infer<typeof PlayerAuctionBidResultSchema>;
export type PlayerAuctionBidChannel = z.infer<typeof PlayerAuctionBidChannelSchema>;
export type PlaceMiniprogramAuctionBidRequest = z.infer<typeof PlaceMiniprogramAuctionBidRequestSchema>;
export type MyPlayerAuctionListQuery = z.infer<typeof MyPlayerAuctionListQuerySchema>;
export type MyPlayerAuctionListItem = z.infer<typeof MyPlayerAuctionListItemSchema>;
export type MyPlayerAuctionRoom = z.infer<typeof MyPlayerAuctionRoomSchema>;
export type AuctionPlayerCardSnapshot = z.infer<typeof AuctionPlayerCardSnapshotSchema>;
export type MyPlayerAuctionSaleListQuery = z.infer<typeof MyPlayerAuctionSaleListQuerySchema>;
export type MyPlayerAuctionSale = z.infer<typeof MyPlayerAuctionSaleSchema>;
export type MyPlayerAuctionSaleListResponse = z.infer<typeof MyPlayerAuctionSaleListResponseSchema>;
export type CreatePlayerAuctionBatchRequest = z.infer<typeof CreatePlayerAuctionBatchRequestSchema>;
export type UpdatePlayerAuctionBatchRequest = z.infer<typeof UpdatePlayerAuctionBatchRequestSchema>;
export type PlayerAuctionTransitionRequest = z.infer<typeof PlayerAuctionTransitionRequestSchema>;
export type ReplacePlayerAuctionLotsRequest = z.infer<typeof ReplacePlayerAuctionLotsRequestSchema>;
export type PreparePlayerAuctionBatchRequest = z.infer<typeof PreparePlayerAuctionBatchRequestSchema>;
export type CancelPlayerAuctionBatchRequest = z.infer<typeof CancelPlayerAuctionBatchRequestSchema>;
export type ReviewPlayerAuctionLotRequest = z.infer<typeof ReviewPlayerAuctionLotRequestSchema>;
export type PlayerAuctionBatchDetail = z.infer<typeof PlayerAuctionBatchDetailSchema>;
