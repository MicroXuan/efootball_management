import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import {
  CompetitionStageCodeSchema,
  CompetitionStageSummarySchema,
  ExpectedVersionSchema,
  StandingsSnapshotResponseSchema
} from './competition.js';
import { GamePlatformSchema } from './game-account.js';

const TimestampSchema = z.iso.datetime();
const NullableLogoUrlSchema = z.url().max(2_048).nullable();
const CapacitySchema = z.number().int().min(2).max(64);
const PromotionCountSchema = z.number().int().min(0).max(32);

export const LeagueStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const LeagueEditionSchema = z.enum(['NATIONAL', 'INTERNATIONAL']);
export const TeamProfileStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const LeagueSeasonStatusSchema = z.enum([
  'DRAFT',
  'REGISTRATION_OPEN',
  'ALLOCATION_REVIEW',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
]);
export const SeasonEntrySourceSchema = z.enum(['NEW_APPLICATION', 'RENEWAL']);
export const SeasonEntryStatusSchema = z.enum([
  'INVITED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN'
]);

const TeamProfileFieldsSchema = z.object({
  name: z.string().trim().min(1).max(64),
  shortName: z.string().trim().min(1).max(24),
  logoUrl: NullableLogoUrlSchema,
  defaultGameAccountId: ResourceIdSchema
});

export const CreateTeamProfileRequestSchema = TeamProfileFieldsSchema.extend({
  logoUrl: NullableLogoUrlSchema.default(null)
});
export const UpdateTeamProfileRequestSchema = TeamProfileFieldsSchema.partial().extend({
  expectedVersion: ExpectedVersionSchema
});
export const TeamProfileSchema = z.object({
  id: ResourceIdSchema,
  ownerUserId: ResourceIdSchema,
  name: z.string(),
  shortName: z.string(),
  logoUrl: z.string().nullable(),
  defaultGameAccountId: ResourceIdSchema.nullable(),
  status: TeamProfileStatusSchema,
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

const LeagueFieldsSchema = z.object({
  name: z.string().trim().min(1).max(64),
  shortName: z.string().trim().min(1).max(24),
  description: z.string().trim().max(500),
  logoUrl: NullableLogoUrlSchema,
  edition: LeagueEditionSchema,
  defaultSuperCapacity: CapacitySchema,
  defaultChampionCapacity: CapacitySchema,
  defaultPromotionCount: PromotionCountSchema
});

export const CreateLeagueRequestSchema = LeagueFieldsSchema.extend({
  description: z.string().trim().max(500).default(''),
  logoUrl: NullableLogoUrlSchema.default(null),
  defaultSuperCapacity: CapacitySchema.default(23),
  defaultChampionCapacity: CapacitySchema.default(18),
  defaultPromotionCount: PromotionCountSchema.default(4)
});
export const UpdateLeagueRequestSchema = LeagueFieldsSchema.partial().extend({
  status: LeagueStatusSchema.optional(),
  expectedVersion: ExpectedVersionSchema
});

const SeasonTimelineSchema = z.object({
  registrationOpensAt: TimestampSchema,
  registrationClosesAt: TimestampSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema
}).superRefine((value, context) => {
  const registrationOpensAt = Date.parse(value.registrationOpensAt);
  const registrationClosesAt = Date.parse(value.registrationClosesAt);
  const startsAt = Date.parse(value.startsAt);
  const endsAt = Date.parse(value.endsAt);

  if (registrationOpensAt >= registrationClosesAt) {
    context.addIssue({
      code: 'custom',
      path: ['registrationClosesAt'],
      message: 'registrationClosesAt must be after registrationOpensAt'
    });
  }
  if (registrationClosesAt >= startsAt) {
    context.addIssue({
      code: 'custom',
      path: ['startsAt'],
      message: 'startsAt must be after registrationClosesAt'
    });
  }
  if (startsAt >= endsAt) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'endsAt must be after startsAt'
    });
  }
});

const SeasonEditableFieldsSchema = z.object({
  displayName: z.string().trim().min(1).max(64),
  registrationOpensAt: TimestampSchema,
  registrationClosesAt: TimestampSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  superCapacity: CapacitySchema.optional(),
  championCapacity: CapacitySchema.optional(),
  promotionCount: PromotionCountSchema.optional()
});

export const CreateLeagueSeasonRequestSchema = z.object({
  seasonNumber: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(64),
  superCapacity: CapacitySchema.optional(),
  championCapacity: CapacitySchema.optional(),
  promotionCount: PromotionCountSchema.optional()
}).and(SeasonTimelineSchema);

export const UpdateLeagueSeasonRequestSchema = SeasonEditableFieldsSchema.partial().extend({
  expectedVersion: ExpectedVersionSchema
});

export const SeasonTransitionRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema
});
export const CancelLeagueSeasonRequestSchema = SeasonTransitionRequestSchema.extend({
  reason: z.string().trim().min(1).max(512)
});

export const LeagueSeasonSummarySchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  seasonNumber: z.number().int().positive(),
  displayName: z.string(),
  previousSeasonId: ResourceIdSchema.nullable(),
  isFirstSeason: z.boolean(),
  registrationOpensAt: TimestampSchema,
  registrationClosesAt: TimestampSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  superCapacity: CapacitySchema,
  championCapacity: CapacitySchema,
  promotionCount: PromotionCountSchema,
  status: LeagueSeasonStatusSchema,
  entryCount: z.number().int().nonnegative(),
  approvedEntryCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const LeagueSeasonCapabilitiesSchema = z.object({
  canManage: z.boolean(),
  canReviewEntries: z.boolean(),
  canApply: z.boolean(),
  canConfirmRenewal: z.boolean(),
  canWithdraw: z.boolean()
});

export const SeasonEntrySchema = z.object({
  id: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  teamProfileId: ResourceIdSchema.nullable(),
  leagueTeamId: ResourceIdSchema,
  ownerUserId: ResourceIdSchema,
  gameAccountId: ResourceIdSchema.nullable(),
  source: SeasonEntrySourceSchema,
  status: SeasonEntryStatusSchema,
  previousSeasonEntryId: ResourceIdSchema.nullable(),
  teamNameSnapshot: z.string(),
  teamShortNameSnapshot: z.string(),
  teamNumberSnapshot: z.number().int().min(0).max(9_999).nullable(),
  teamLogoUrlSnapshot: z.string().nullable(),
  gamePlatformSnapshot: GamePlatformSchema.nullable(),
  serverRegionSnapshot: z.string().nullable(),
  gamerTagSnapshot: z.string().nullable(),
  gameUidSnapshot: z.string().nullable(),
  leagueEditionSnapshot: LeagueEditionSchema,
  reviewedById: ResourceIdSchema.nullable(),
  reviewedAt: TimestampSchema.nullable(),
  decisionReason: z.string().nullable(),
  confirmedAt: TimestampSchema.nullable(),
  withdrawnAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const LeagueSeasonDetailSchema = LeagueSeasonSummarySchema.extend({
  currentEntry: SeasonEntrySchema.nullable(),
  capabilities: LeagueSeasonCapabilitiesSchema
});

export const CurrentSeasonSummarySchema = z.object({
  id: ResourceIdSchema,
  displayName: z.string(),
  status: LeagueSeasonStatusSchema,
  approvedEntryCount: z.number().int().nonnegative()
});

export const LeagueSummarySchema = z.object({
  id: ResourceIdSchema,
  name: z.string(),
  shortName: z.string(),
  description: z.string(),
  logoUrl: z.string().nullable(),
  status: LeagueStatusSchema,
  edition: LeagueEditionSchema,
  defaultSuperCapacity: CapacitySchema,
  defaultChampionCapacity: CapacitySchema,
  defaultPromotionCount: PromotionCountSchema,
  currentSeason: CurrentSeasonSummarySchema.nullable(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const LeagueCapabilitiesSchema = z.object({
  canManage: z.boolean(),
  canCreateSeason: z.boolean()
});

export const LeagueDetailSchema = LeagueSummarySchema.extend({
  capabilities: LeagueCapabilitiesSchema
});

export const LeagueListQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
export const LeagueListResponseSchema = z.object({
  items: z.array(LeagueSummarySchema),
  nextCursor: z.string().nullable()
});

export const CreateSeasonApplicationRequestSchema = z.object({
  gameAccountId: ResourceIdSchema
});
export const ConfirmSeasonRenewalRequestSchema = z.object({
  gameAccountId: ResourceIdSchema,
  expectedVersion: ExpectedVersionSchema
});
export const ReviewSeasonEntryRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  expectedVersion: ExpectedVersionSchema,
  reason: z.string().trim().min(1).max(512).nullable().optional()
}).superRefine((value, context) => {
  if (value.decision === 'REJECT' && !value.reason) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason is required when rejecting a season entry'
    });
  }
});
export const OverrideSeasonEntryRequestSchema = z.object({
  targetStatus: SeasonEntryStatusSchema,
  expectedVersion: ExpectedVersionSchema,
  reason: z.string().trim().min(1).max(512)
});
export const SeasonEntryListQuerySchema = z.object({
  status: SeasonEntryStatusSchema.optional(),
  source: SeasonEntrySourceSchema.optional()
});
export const WithdrawSeasonEntryRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema
});
export const SetCurrentSeasonRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema
});
export const EnrollLeagueTeamsRequestSchema = z.object({
  leagueTeamIds: z.array(ResourceIdSchema).min(1).max(64).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: 'leagueTeamIds must not contain duplicates' }
  ),
  expectedSeasonVersion: ExpectedVersionSchema
});

export const SeasonAllocationProposalStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'SUPERSEDED']);
export const SeasonAllocationSourceSchema = z.enum([
  'FIRST_SEASON',
  'RETAINED',
  'PROMOTED',
  'RELEGATED',
  'REPLACEMENT',
  'CHAMPION_POOL',
  'NEW_ENTRY'
]);

export const GenerateSeasonAllocationRequestSchema = z.object({
  expectedSeasonVersion: ExpectedVersionSchema,
  randomSeed: z.number().int().positive()
});

const SeasonAllocationOverrideSchema = z.object({
  seasonEntryId: ResourceIdSchema,
  targetStageCode: CompetitionStageCodeSchema,
  reason: z.string().trim().min(1).max(512)
});

export const ConfirmSeasonAllocationRequestSchema = z.object({
  proposalId: ResourceIdSchema,
  expectedSeasonVersion: ExpectedVersionSchema,
  overrides: z.array(SeasonAllocationOverrideSchema).max(64).default([])
}).superRefine((value, context) => {
  const seen = new Set<string>();
  value.overrides.forEach((override, index) => {
    if (seen.has(override.seasonEntryId)) {
      context.addIssue({
        code: 'custom',
        path: ['overrides', index, 'seasonEntryId'],
        message: 'seasonEntryId must not be duplicated'
      });
    }
    seen.add(override.seasonEntryId);
  });
});

export const SeasonAllocationProposalRowSchema = z.object({
  id: ResourceIdSchema,
  proposalId: ResourceIdSchema,
  seasonEntryId: ResourceIdSchema,
  teamName: z.string().trim().min(1).max(64),
  suggestedStageCode: CompetitionStageCodeSchema,
  source: SeasonAllocationSourceSchema,
  previousRank: z.number().int().positive().nullable(),
  pointsPerMatch: z.number().finite().nonnegative().nullable(),
  goalDifferencePerMatch: z.number().finite().nullable(),
  goalsForPerMatch: z.number().finite().nonnegative().nullable(),
  tiePending: z.boolean(),
  reason: z.string().trim().min(1).max(512)
});

export const SeasonAllocationProposalSchema = z.object({
  id: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  version: z.number().int().positive(),
  status: SeasonAllocationProposalStatusSchema,
  algorithmVersion: z.string().trim().min(1).max(32),
  randomSeed: z.number().int().positive(),
  rows: z.array(SeasonAllocationProposalRowSchema),
  createdAt: TimestampSchema
});

export const SeasonAllocationDecisionSchema = z.object({
  id: ResourceIdSchema,
  proposalId: ResourceIdSchema,
  seasonEntryId: ResourceIdSchema,
  finalStageCode: CompetitionStageCodeSchema,
  overridden: z.boolean(),
  reason: z.string().trim().min(1).max(512).nullable(),
  createdAt: TimestampSchema
}).superRefine((value, context) => {
  if (value.overridden && !value.reason) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason is required for an overridden allocation'
    });
  }
});

export const DivisionStandingsResponseSchema = z.object({
  seasonId: ResourceIdSchema,
  competitionId: ResourceIdSchema,
  myStageId: ResourceIdSchema.nullable(),
  groups: z.array(z.object({
    stage: CompetitionStageSummarySchema,
    standings: StandingsSnapshotResponseSchema
  }))
});

export const LeagueWorkspaceResponseSchema = z.object({
  leagueId: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  team: z.object({
    leagueTeamId: ResourceIdSchema,
    name: z.string().trim().min(1).max(64),
    shortName: z.string().trim().min(1).max(24),
    logoUrl: z.string().url().nullable()
  }),
  division: z.object({
    stageId: ResourceIdSchema,
    stageCode: CompetitionStageCodeSchema,
    displayName: z.string().trim().min(1).max(64)
  }).nullable(),
  currentRank: z.object({
    rank: z.number().int().positive(),
    points: z.number().int(),
    played: z.number().int().nonnegative(),
    tiePending: z.boolean()
  }).nullable(),
  nextMatch: z.object({
    id: ResourceIdSchema,
    roundNumber: z.number().int().positive(),
    plannedAt: TimestampSchema.nullable(),
    opponentName: z.string().trim().min(1).max(64),
    side: z.enum(['HOME', 'AWAY'])
  }).nullable(),
  capabilities: z.object({
    canViewStandings: z.boolean(),
    canViewAssets: z.boolean(),
    canViewFinance: z.boolean(),
    canManageValuations: z.boolean()
  })
});

export type LeagueStatus = z.infer<typeof LeagueStatusSchema>;
export type LeagueEdition = z.infer<typeof LeagueEditionSchema>;
export type TeamProfileStatus = z.infer<typeof TeamProfileStatusSchema>;
export type LeagueSeasonStatus = z.infer<typeof LeagueSeasonStatusSchema>;
export type SeasonEntrySource = z.infer<typeof SeasonEntrySourceSchema>;
export type SeasonEntryStatus = z.infer<typeof SeasonEntryStatusSchema>;
export type SeasonAllocationProposalStatus = z.infer<typeof SeasonAllocationProposalStatusSchema>;
export type SeasonAllocationSource = z.infer<typeof SeasonAllocationSourceSchema>;

export type CreateTeamProfileRequest = z.input<typeof CreateTeamProfileRequestSchema>;
export type ParsedCreateTeamProfileRequest = z.output<typeof CreateTeamProfileRequestSchema>;
export type UpdateTeamProfileRequest = z.infer<typeof UpdateTeamProfileRequestSchema>;
export type TeamProfileResponse = z.infer<typeof TeamProfileSchema>;

export type CreateLeagueRequest = z.input<typeof CreateLeagueRequestSchema>;
export type ParsedCreateLeagueRequest = z.output<typeof CreateLeagueRequestSchema>;
export type UpdateLeagueRequest = z.infer<typeof UpdateLeagueRequestSchema>;
export type LeagueSummary = z.infer<typeof LeagueSummarySchema>;
export type LeagueDetail = z.infer<typeof LeagueDetailSchema>;
export type LeagueListQuery = z.output<typeof LeagueListQuerySchema>;
export type LeagueListResponse = z.infer<typeof LeagueListResponseSchema>;

export type CreateLeagueSeasonRequest = z.input<typeof CreateLeagueSeasonRequestSchema>;
export type ParsedCreateLeagueSeasonRequest = z.output<typeof CreateLeagueSeasonRequestSchema>;
export type UpdateLeagueSeasonRequest = z.infer<typeof UpdateLeagueSeasonRequestSchema>;
export type LeagueSeasonSummary = z.infer<typeof LeagueSeasonSummarySchema>;
export type LeagueSeasonDetail = z.infer<typeof LeagueSeasonDetailSchema>;
export type CurrentSeasonSummary = z.infer<typeof CurrentSeasonSummarySchema>;
export type SeasonTransitionRequest = z.infer<typeof SeasonTransitionRequestSchema>;
export type CancelLeagueSeasonRequest = z.infer<typeof CancelLeagueSeasonRequestSchema>;

export type CreateSeasonApplicationRequest = z.infer<typeof CreateSeasonApplicationRequestSchema>;
export type ConfirmSeasonRenewalRequest = z.infer<typeof ConfirmSeasonRenewalRequestSchema>;
export type ReviewSeasonEntryRequest = z.infer<typeof ReviewSeasonEntryRequestSchema>;
export type OverrideSeasonEntryRequest = z.infer<typeof OverrideSeasonEntryRequestSchema>;
export type SeasonEntryListQuery = z.infer<typeof SeasonEntryListQuerySchema>;
export type WithdrawSeasonEntryRequest = z.infer<typeof WithdrawSeasonEntryRequestSchema>;
export type SetCurrentSeasonRequest = z.infer<typeof SetCurrentSeasonRequestSchema>;
export type EnrollLeagueTeamsRequest = z.infer<typeof EnrollLeagueTeamsRequestSchema>;
export type SeasonEntryResponse = z.infer<typeof SeasonEntrySchema>;
export type GenerateSeasonAllocationRequest = z.infer<typeof GenerateSeasonAllocationRequestSchema>;
export type ConfirmSeasonAllocationRequest = z.infer<typeof ConfirmSeasonAllocationRequestSchema>;
export type SeasonAllocationProposalRow = z.infer<typeof SeasonAllocationProposalRowSchema>;
export type SeasonAllocationProposal = z.infer<typeof SeasonAllocationProposalSchema>;
export type SeasonAllocationDecision = z.infer<typeof SeasonAllocationDecisionSchema>;
export type DivisionStandingsResponse = z.infer<typeof DivisionStandingsResponseSchema>;
export type LeagueWorkspaceResponse = z.infer<typeof LeagueWorkspaceResponseSchema>;
