import { z } from 'zod';
import { ExpectedVersionSchema, ResourceIdSchema } from './common.js';

const TimestampSchema = z.iso.datetime();
const PositiveMoneySchema = z.number().int().positive().max(2_147_483_647);
const NullableTimestampSchema = TimestampSchema.nullable();

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
  groupBindingId: ResourceIdSchema,
  name: z.string().trim().min(1).max(128),
  expectedVersion: ExpectedVersionSchema
});

export const UpdatePlayerAuctionBatchRequestSchema = z.object({
  name: z.string().trim().min(1).max(128),
  expectedVersion: ExpectedVersionSchema
});

export const PlayerAuctionLotInputSchema = z.object({
  playerId: ResourceIdSchema,
  playerCardId: ResourceIdSchema.nullable().optional(),
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
  teamName: z.string().trim().min(1).max(128).nullable(),
  userId: ResourceIdSchema.nullable(),
  amount: PositiveMoneySchema,
  result: PlayerAuctionBidResultSchema,
  rejectionReason: z.string().max(512).nullable(),
  wechatMessageId: z.string().trim().min(1).max(256),
  wechatSortKey: z.string().trim().min(1).max(128),
  wechatSentAt: TimestampSchema,
  receivedAt: TimestampSchema
});

export const PlayerAuctionReviewSchema = z.object({
  id: ResourceIdSchema,
  decision: PlayerAuctionReviewDecisionSchema,
  computedWinnerTeamId: ResourceIdSchema.nullable(),
  computedWinnerTeamName: z.string().trim().min(1).max(128).nullable(),
  computedPrice: PositiveMoneySchema.nullable(),
  reviewedWinnerTeamId: ResourceIdSchema.nullable(),
  reviewedWinnerTeamName: z.string().trim().min(1).max(128).nullable(),
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
  groupBindingId: ResourceIdSchema,
  groupDisplayName: z.string().trim().min(1).max(128),
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
  groupBindingId: ResourceIdSchema,
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
export type CreatePlayerAuctionBatchRequest = z.infer<typeof CreatePlayerAuctionBatchRequestSchema>;
export type UpdatePlayerAuctionBatchRequest = z.infer<typeof UpdatePlayerAuctionBatchRequestSchema>;
export type ReplacePlayerAuctionLotsRequest = z.infer<typeof ReplacePlayerAuctionLotsRequestSchema>;
export type PreparePlayerAuctionBatchRequest = z.infer<typeof PreparePlayerAuctionBatchRequestSchema>;
export type CancelPlayerAuctionBatchRequest = z.infer<typeof CancelPlayerAuctionBatchRequestSchema>;
export type ReviewPlayerAuctionLotRequest = z.infer<typeof ReviewPlayerAuctionLotRequestSchema>;
export type PlayerAuctionBatchDetail = z.infer<typeof PlayerAuctionBatchDetailSchema>;

