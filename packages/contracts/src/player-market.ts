import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { ExpectedVersionSchema } from './competition.js';
import { MoneyMinorSchema, OverallRatingSchema } from './league-roster.js';
import { PlayerPositionSchema } from './player-catalog.js';

const TimestampSchema = z.iso.datetime();
const NonNegativeMoneyMinorSchema = z.number().int().nonnegative().max(4_294_967_295);

export const PlayerApplicationTypeSchema = z.enum(['NORMAL_PURCHASE', 'FORCED_TRANSFER']);
export const PlayerApplicationStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'NOT_SELECTED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
  'INELIGIBLE',
  'REQUOTE_REQUIRED',
  'OWNERSHIP_CHANGED'
]);
export const PlayerApplicationEventTypeSchema = z.enum([
  'SUBMITTED',
  'AMOUNT_CHANGED',
  'WITHDRAWN',
  'APPROVED',
  'REJECTED',
  'NOT_SELECTED',
  'EXPIRED',
  'REQUOTE_REQUIRED',
  'OWNERSHIP_CHANGED',
  'INELIGIBLE'
]);
export const PlayerMarketActionSchema = z.enum(['APPLY', 'FORCE_SIGN', 'OWNED_BY_ME', 'DISABLED']);

export const PlayerMarketTeamSummarySchema = z.object({
  teamId: ResourceIdSchema,
  teamNumber: z.number().int().nonnegative().nullable(),
  name: z.string().min(1),
  logoUrl: z.string().nullable(),
  ownerAlias: z.string().min(1)
});

export const PlayerMarketCardSummarySchema = z.object({
  playerCardId: ResourceIdSchema,
  cardName: z.string().min(1),
  imageUrl: z.string().nullable(),
  position: PlayerPositionSchema,
  maxOverall: OverallRatingSchema.min(1).nullable(),
  salaryMinor: NonNegativeMoneyMinorSchema.nullable()
});

export const PlayerMarketPlayerSummarySchema = z.object({
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  nationality: z.string().nullable(),
  club: z.string().nullable(),
  currentOwner: PlayerMarketTeamSummarySchema.nullable(),
  ownershipId: ResourceIdSchema.nullable(),
  ownershipVersion: z.number().int().positive().nullable(),
  officialValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  valuationVersion: z.number().int().positive().nullable(),
  card: PlayerMarketCardSummarySchema.nullable(),
  forcedTransferBadge: z.boolean(),
  action: PlayerMarketActionSchema,
  disabledReason: z.string().min(1).nullable()
});

export const PlayerMarketQuerySchema = z.object({
  seasonId: ResourceIdSchema,
  keyword: z.string().trim().min(1).max(80).optional(),
  position: PlayerPositionSchema.optional(),
  ownership: z.enum(['ALL', 'FREE', 'OWNED']).default('ALL'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const PlayerMarketListResponseSchema = z.object({
  items: z.array(PlayerMarketPlayerSummarySchema),
  nextCursor: z.string().nullable(),
  activeTransferWindowId: ResourceIdSchema.nullable()
});

export const PlayerApplicationEventSchema = z.object({
  id: ResourceIdSchema,
  type: PlayerApplicationEventTypeSchema,
  fromStatus: PlayerApplicationStatusSchema.nullable(),
  toStatus: PlayerApplicationStatusSchema,
  fromAmountMinor: NonNegativeMoneyMinorSchema.nullable(),
  toAmountMinor: NonNegativeMoneyMinorSchema.nullable(),
  actorType: z.enum(['USER', 'ADMIN', 'SYSTEM']),
  actorDisplayName: z.string().min(1),
  reason: z.string().max(512).nullable(),
  createdAt: TimestampSchema
});

export const PlayerAcquisitionApplicationSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  transferWindowId: ResourceIdSchema,
  type: PlayerApplicationTypeSchema,
  applicantTeam: PlayerMarketTeamSummarySchema,
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  playerCard: PlayerMarketCardSummarySchema,
  sourceTeam: PlayerMarketTeamSummarySchema.nullable(),
  ownershipId: ResourceIdSchema.nullable(),
  ownershipVersionSnapshot: z.number().int().positive().nullable(),
  amountMinor: MoneyMinorSchema,
  valuationMinorSnapshot: NonNegativeMoneyMinorSchema.nullable(),
  valuationVersionSnapshot: z.number().int().positive().nullable(),
  status: PlayerApplicationStatusSchema,
  queuePosition: z.number().int().positive().nullable(),
  firstValidSubmittedAt: TimestampSchema,
  lastSubmittedAt: TimestampSchema,
  reviewedAt: TimestampSchema.nullable(),
  reviewReason: z.string().max(512).nullable(),
  version: z.number().int().positive(),
  events: z.array(PlayerApplicationEventSchema).default([])
});

export const PlayerApplicationListQuerySchema = z.object({
  seasonId: ResourceIdSchema,
  type: PlayerApplicationTypeSchema.optional(),
  status: PlayerApplicationStatusSchema.optional(),
  playerId: ResourceIdSchema.optional(),
  scope: z.enum(['PUBLIC', 'MINE']).default('PUBLIC'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const PlayerApplicationListResponseSchema = z.object({
  items: z.array(PlayerAcquisitionApplicationSchema),
  nextCursor: z.string().nullable()
});

export const PlayerMarketAnnouncementSchema = z.object({
  id: ResourceIdSchema,
  kind: z.enum(['NORMAL_PURCHASE', 'FORCED_TRANSFER', 'RELEASE', 'APPLICATION_CLOSED']),
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  sourceTeam: PlayerMarketTeamSummarySchema.nullable(),
  targetTeam: PlayerMarketTeamSummarySchema.nullable(),
  amountMinor: NonNegativeMoneyMinorSchema.nullable(),
  message: z.string().min(1),
  createdAt: TimestampSchema
});

export const PlayerMarketAnnouncementQuerySchema = z.object({
  seasonId: ResourceIdSchema,
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const PlayerMarketAnnouncementListResponseSchema = z.object({
  items: z.array(PlayerMarketAnnouncementSchema),
  nextCursor: z.string().nullable()
});

export const PlayerMarketPlayerDetailSchema = PlayerMarketPlayerSummarySchema.extend({
  playerEnglishName: z.string().nullable(),
  activeTransferWindowId: ResourceIdSchema.nullable(),
  myApplication: PlayerAcquisitionApplicationSchema.nullable(),
  publicApplications: z.array(PlayerAcquisitionApplicationSchema)
});

const SubmitPlayerApplicationFieldsSchema = z.object({
  seasonId: ResourceIdSchema,
  transferWindowId: ResourceIdSchema,
  footballPlayerId: ResourceIdSchema,
  playerCardId: ResourceIdSchema,
  type: PlayerApplicationTypeSchema,
  amountMinor: MoneyMinorSchema,
  sourceLeagueTeamId: ResourceIdSchema.optional(),
  ownershipId: ResourceIdSchema.optional(),
  ownershipVersionSnapshot: ExpectedVersionSchema.optional()
});

export const SubmitPlayerApplicationRequestSchema = SubmitPlayerApplicationFieldsSchema.superRefine((input, context) => {
  const forcedFields = ['sourceLeagueTeamId', 'ownershipId', 'ownershipVersionSnapshot'] as const;
  if (input.type === 'FORCED_TRANSFER') {
    for (const field of forcedFields) {
      if (input[field] === undefined) {
        context.addIssue({ code: 'custom', path: [field], message: `${field} is required for a forced transfer` });
      }
    }
  } else {
    for (const field of forcedFields) {
      if (input[field] !== undefined) {
        context.addIssue({ code: 'custom', path: [field], message: `${field} is only valid for a forced transfer` });
      }
    }
  }
});

export const AmendPlayerApplicationRequestSchema = z.object({
  amountMinor: MoneyMinorSchema,
  expectedVersion: ExpectedVersionSchema
});

export const WithdrawPlayerApplicationRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  reason: z.string().trim().min(1).max(512)
});

export const ReviewPlayerApplicationRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  reason: z.string().trim().min(1).max(512)
});

export const ReleaseOwnedPlayerRequestSchema = z.object({
  seasonId: ResourceIdSchema,
  transferWindowId: ResourceIdSchema,
  ownershipId: ResourceIdSchema,
  expectedVersion: ExpectedVersionSchema,
  reason: z.string().trim().min(1).max(512)
});

export type PlayerApplicationType = z.infer<typeof PlayerApplicationTypeSchema>;
export type PlayerApplicationStatus = z.infer<typeof PlayerApplicationStatusSchema>;
export type PlayerApplicationEventType = z.infer<typeof PlayerApplicationEventTypeSchema>;
export type PlayerMarketAction = z.infer<typeof PlayerMarketActionSchema>;
export type PlayerMarketTeamSummary = z.infer<typeof PlayerMarketTeamSummarySchema>;
export type PlayerMarketCardSummary = z.infer<typeof PlayerMarketCardSummarySchema>;
export type PlayerMarketPlayerSummary = z.infer<typeof PlayerMarketPlayerSummarySchema>;
export type PlayerMarketQuery = z.infer<typeof PlayerMarketQuerySchema>;
export type PlayerMarketListResponse = z.infer<typeof PlayerMarketListResponseSchema>;
export type PlayerApplicationEvent = z.infer<typeof PlayerApplicationEventSchema>;
export type PlayerAcquisitionApplication = z.infer<typeof PlayerAcquisitionApplicationSchema>;
export type PlayerApplicationListQuery = z.infer<typeof PlayerApplicationListQuerySchema>;
export type PlayerApplicationListResponse = z.infer<typeof PlayerApplicationListResponseSchema>;
export type PlayerMarketAnnouncement = z.infer<typeof PlayerMarketAnnouncementSchema>;
export type PlayerMarketAnnouncementQuery = z.infer<typeof PlayerMarketAnnouncementQuerySchema>;
export type PlayerMarketAnnouncementListResponse = z.infer<typeof PlayerMarketAnnouncementListResponseSchema>;
export type PlayerMarketPlayerDetail = z.infer<typeof PlayerMarketPlayerDetailSchema>;
export type SubmitPlayerApplicationRequest = z.infer<typeof SubmitPlayerApplicationRequestSchema>;
export type AmendPlayerApplicationRequest = z.infer<typeof AmendPlayerApplicationRequestSchema>;
export type WithdrawPlayerApplicationRequest = z.infer<typeof WithdrawPlayerApplicationRequestSchema>;
export type ReviewPlayerApplicationRequest = z.infer<typeof ReviewPlayerApplicationRequestSchema>;
export type ReleaseOwnedPlayerRequest = z.infer<typeof ReleaseOwnedPlayerRequestSchema>;
