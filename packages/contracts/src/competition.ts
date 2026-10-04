import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { GamePlatformSchema } from './game-account.js';

export const CompetitionStatusSchema = z.enum([
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
]);

export const CompetitionParticipantTypeSchema = z.enum(['INDIVIDUAL', 'TEAM']);
export const CompetitionTypeSchema = z.enum([
  'OPEN_EVENT',
  'DIVISION_LEAGUE',
  'GROUP_KNOCKOUT_CUP',
  'KNOCKOUT_CUP'
]);
export const CompetitionFormatSchema = z.enum([
  'ROUND_ROBIN',
  'DOUBLE_ROUND_ROBIN',
  'SINGLE_ELIMINATION',
  'GROUP_KNOCKOUT'
]);
export const CompetitionRegistrationStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN'
]);
export const CompetitionMatchStatusSchema = z.enum([
  'SCHEDULED',
  'AWAITING_RESULT',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'ADMIN_DECIDED'
]);
export const MatchResultVersionStatusSchema = z.enum([
  'PROPOSED',
  'REJECTED',
  'OFFICIAL',
  'SUPERSEDED'
]);
export const MatchResultSubmissionSideSchema = z.enum(['HOME', 'AWAY', 'MANAGER']);
export const CompetitionTieBreakerSchema = z.enum([
  'TOTAL_POINTS',
  'HEAD_TO_HEAD_POINTS',
  'HEAD_TO_HEAD_GOAL_DIFFERENCE',
  'TOTAL_GOAL_DIFFERENCE',
  'TOTAL_GOALS',
  'WINS'
]);
export const CompetitionStageCodeSchema = z.string().regex(
  /^(SUPER|CHAMPION_[A-Z]+|GROUP_[A-Z]+|ROUND_OF_(?:16|32|64|128)|QUARTER_FINAL|SEMI_FINAL|FINAL)$/,
  'invalid competition stage code'
);

export const IdempotencyKeySchema = z.string().trim().min(1).max(128);
export const ExpectedVersionSchema = z.number().int().positive();
const TimestampSchema = z.iso.datetime();
const ScoreSchema = z.number().int().min(0).max(99);

const CompetitionTimelineSchema = z.object({
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
  if (registrationClosesAt > startsAt) {
    context.addIssue({
      code: 'custom',
      path: ['startsAt'],
      message: 'startsAt must be at or after registrationClosesAt'
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

const CompetitionCoreInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2_000).default(''),
  platform: GamePlatformSchema,
  serverRegion: z.string().trim().min(1).max(32),
  participantType: z.literal('INDIVIDUAL'),
  format: z.literal('ROUND_ROBIN'),
  participantLimit: z.number().int().min(2).max(128)
});

export const CreateCompetitionRequestSchema = CompetitionCoreInputSchema
  .and(CompetitionTimelineSchema);

export const CupCompetitionTypeSchema = z.enum(['GROUP_KNOCKOUT_CUP', 'KNOCKOUT_CUP']);

export const CreateSeasonCupRequestSchema = z.object({
  seasonId: ResourceIdSchema,
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2_000).default(''),
  competitionType: CupCompetitionTypeSchema,
  format: z.enum(['GROUP_KNOCKOUT', 'SINGLE_ELIMINATION']),
  platform: GamePlatformSchema,
  serverRegion: z.string().trim().min(1).max(32),
  registrationOpensAt: TimestampSchema,
  registrationClosesAt: TimestampSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  participantLimit: z.number().int().min(2).max(128),
  targetGroupSize: z.number().int().min(2).max(16).nullable(),
  qualifiersPerGroup: z.number().int().min(1).max(15).nullable()
}).superRefine((value, context) => {
  const registrationOpensAt = Date.parse(value.registrationOpensAt);
  const registrationClosesAt = Date.parse(value.registrationClosesAt);
  const startsAt = Date.parse(value.startsAt);
  const endsAt = Date.parse(value.endsAt);
  if (registrationOpensAt >= registrationClosesAt) {
    context.addIssue({ code: 'custom', path: ['registrationClosesAt'], message: '报名结束时间必须晚于开始时间' });
  }
  if (registrationClosesAt > startsAt) {
    context.addIssue({ code: 'custom', path: ['startsAt'], message: '开赛时间不能早于报名结束时间' });
  }
  if (startsAt >= endsAt) {
    context.addIssue({ code: 'custom', path: ['endsAt'], message: '结束时间必须晚于开赛时间' });
  }

  if (value.competitionType === 'GROUP_KNOCKOUT_CUP') {
    if (value.format !== 'GROUP_KNOCKOUT') {
      context.addIssue({ code: 'custom', path: ['format'], message: '小组淘汰杯必须使用小组加淘汰赛制' });
    }
    if (value.targetGroupSize === null) {
      context.addIssue({ code: 'custom', path: ['targetGroupSize'], message: '小组淘汰杯必须设置目标小组人数' });
    }
    if (value.qualifiersPerGroup === null) {
      context.addIssue({ code: 'custom', path: ['qualifiersPerGroup'], message: '小组淘汰杯必须设置每组出线人数' });
    }
    if (value.targetGroupSize !== null && value.qualifiersPerGroup !== null
      && value.qualifiersPerGroup >= value.targetGroupSize) {
      context.addIssue({ code: 'custom', path: ['qualifiersPerGroup'], message: '每组出线人数必须小于目标小组人数' });
    }
  } else {
    if (value.format !== 'SINGLE_ELIMINATION') {
      context.addIssue({ code: 'custom', path: ['format'], message: '纯淘汰杯必须使用单场淘汰赛制' });
    }
    if (value.targetGroupSize !== null || value.qualifiersPerGroup !== null) {
      context.addIssue({ code: 'custom', path: ['targetGroupSize'], message: '纯淘汰杯不能设置小组规则' });
    }
  }
});

export const RegisterSeasonCupRequestSchema = z.object({
  seasonEntryId: ResourceIdSchema,
  acceptedRuleVersion: z.number().int().positive()
});

export const WithdrawSeasonCupRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema
});

export const CupRegistrationResponseSchema = z.object({
  id: ResourceIdSchema,
  competitionId: ResourceIdSchema,
  seasonEntryId: ResourceIdSchema,
  applicantId: ResourceIdSchema,
  teamName: z.string().trim().min(1).max(64),
  status: CompetitionRegistrationStatusSchema,
  withdrawnAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const SeasonCupSummarySchema = z.object({
  id: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  name: z.string().trim().min(2).max(80),
  description: z.string().max(2_000),
  competitionType: CupCompetitionTypeSchema,
  format: z.enum(['GROUP_KNOCKOUT', 'SINGLE_ELIMINATION']),
  status: CompetitionStatusSchema,
  registrationOpensAt: TimestampSchema,
  registrationClosesAt: TimestampSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  participantLimit: z.number().int().min(2).max(128),
  participantCount: z.number().int().nonnegative(),
  targetGroupSize: z.number().int().min(2).max(16).nullable(),
  qualifiersPerGroup: z.number().int().min(1).max(15).nullable(),
  version: z.number().int().positive()
});

export const SeasonCupListResponseSchema = z.object({
  items: z.array(SeasonCupSummarySchema)
});

export const UpdateCompetitionRequestSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(2_000).optional(),
  platform: GamePlatformSchema.optional(),
  serverRegion: z.string().trim().min(1).max(32).optional(),
  participantType: CompetitionParticipantTypeSchema.optional(),
  format: CompetitionFormatSchema.optional(),
  registrationOpensAt: TimestampSchema.optional(),
  registrationClosesAt: TimestampSchema.optional(),
  startsAt: TimestampSchema.optional(),
  endsAt: TimestampSchema.optional(),
  participantLimit: z.number().int().min(2).max(128).optional(),
  expectedVersion: ExpectedVersionSchema
});

export const CompetitionRulesSchema = z.object({
  winPoints: z.number().int().min(0).max(20),
  drawPoints: z.number().int().min(0).max(20),
  lossPoints: z.number().int().min(0).max(20),
  tieBreakers: z.array(CompetitionTieBreakerSchema).min(1).max(6)
}).superRefine((value, context) => {
  if (new Set(value.tieBreakers).size !== value.tieBreakers.length) {
    context.addIssue({
      code: 'custom',
      path: ['tieBreakers'],
      message: 'tieBreakers must not contain duplicates'
    });
  }
});

export const UpdateCompetitionRulesRequestSchema = CompetitionRulesSchema.and(z.object({
  expectedVersion: ExpectedVersionSchema
}));

export const RegisterCompetitionRequestSchema = z.object({
  gameAccountId: ResourceIdSchema,
  acceptedRuleVersion: z.number().int().positive()
});

export const ReviewRegistrationRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(512).nullable().optional(),
  expectedVersion: ExpectedVersionSchema
}).superRefine((value, context) => {
  if (value.decision === 'REJECT' && !value.reason) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'reason is required when rejecting a registration'
    });
  }
});

export const VersionedMutationRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema
});

export const GenerateStageScheduleRequestSchema = z.object({
  expectedStageVersion: ExpectedVersionSchema
});

export const PublishStageScheduleRequestSchema = z.object({
  expectedStageVersion: ExpectedVersionSchema,
  expectedSeasonVersion: ExpectedVersionSchema
});

export const CupProposalStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'SUPERSEDED']);

export const GenerateCupGroupProposalRequestSchema = z.object({
  expectedCompetitionVersion: ExpectedVersionSchema,
  randomSeed: z.number().int().positive()
});

export const CupGroupOverrideSchema = z.object({
  participantId: ResourceIdSchema,
  targetGroupCode: CompetitionStageCodeSchema.refine((value) => value.startsWith('GROUP_'), {
    message: 'targetGroupCode must be a cup group code'
  }),
  reason: z.string().trim().min(1).max(512)
});

export const ConfirmCupGroupProposalRequestSchema = z.object({
  proposalId: ResourceIdSchema,
  expectedCompetitionVersion: ExpectedVersionSchema,
  overrides: z.array(CupGroupOverrideSchema).max(128).default([])
}).superRefine((value, context) => {
  const participantIds = new Set<string>();
  value.overrides.forEach((override, index) => {
    if (participantIds.has(override.participantId)) {
      context.addIssue({
        code: 'custom',
        path: ['overrides', index, 'participantId'],
        message: 'participantId must not be overridden more than once'
      });
    }
    participantIds.add(override.participantId);
  });
});

export const CupGroupProposalRowSchema = z.object({
  id: ResourceIdSchema,
  participantId: ResourceIdSchema,
  teamName: z.string().trim().min(1).max(64),
  suggestedGroupCode: CompetitionStageCodeSchema,
  finalGroupCode: CompetitionStageCodeSchema.nullable(),
  overridden: z.boolean(),
  reason: z.string().nullable()
});

export const CupGroupProposalSchema = z.object({
  id: ResourceIdSchema,
  competitionId: ResourceIdSchema,
  version: z.number().int().positive(),
  status: CupProposalStatusSchema,
  algorithmVersion: z.string().trim().min(1).max(32),
  randomSeed: z.number().int().positive(),
  rows: z.array(CupGroupProposalRowSchema),
  createdAt: TimestampSchema
});

export const GenerateCupBracketProposalRequestSchema = z.object({
  expectedCompetitionVersion: ExpectedVersionSchema,
  randomSeed: z.number().int().positive()
});

export const ConfirmCupBracketProposalRequestSchema = z.object({
  proposalId: ResourceIdSchema,
  expectedCompetitionVersion: ExpectedVersionSchema
});

export const CupBracketPairingSchema = z.object({
  id: ResourceIdSchema,
  pairingNumber: z.number().int().positive(),
  homeParticipantId: ResourceIdSchema.nullable(),
  awayParticipantId: ResourceIdSchema.nullable(),
  homeSourcePairingId: ResourceIdSchema.nullable(),
  awaySourcePairingId: ResourceIdSchema.nullable(),
  byeParticipantId: ResourceIdSchema.nullable(),
  matchId: ResourceIdSchema.nullable(),
  winnerParticipantId: ResourceIdSchema.nullable()
});

export const CupBracketRoundSchema = z.object({
  roundNumber: z.number().int().positive(),
  stageCode: CompetitionStageCodeSchema.refine((value) => !value.startsWith('GROUP_'), {
    message: 'stageCode must be a knockout round code'
  }),
  displayName: z.string().trim().min(1).max(64),
  pairings: z.array(CupBracketPairingSchema).min(1)
});

export const CupBracketProposalSchema = z.object({
  id: ResourceIdSchema,
  competitionId: ResourceIdSchema,
  version: z.number().int().positive(),
  status: CupProposalStatusSchema,
  algorithmVersion: z.string().trim().min(1).max(32),
  randomSeed: z.number().int().positive(),
  bracketSize: z.number().int().min(2).max(128),
  rounds: z.array(CupBracketRoundSchema).min(1),
  createdAt: TimestampSchema
});

export const CupBracketParticipantSchema = z.object({
  id: ResourceIdSchema,
  displayName: z.string().trim().min(1).max(64)
});

export const CupBracketMatchSummarySchema = z.object({
  id: ResourceIdSchema,
  status: CompetitionMatchStatusSchema,
  homeScore: ScoreSchema.nullable(),
  awayScore: ScoreSchema.nullable()
});

export const CupBracketViewPairingSchema = z.object({
  id: ResourceIdSchema,
  pairingNumber: z.number().int().positive(),
  homeParticipant: CupBracketParticipantSchema.nullable(),
  awayParticipant: CupBracketParticipantSchema.nullable(),
  winnerParticipant: CupBracketParticipantSchema.nullable(),
  isBye: z.boolean(),
  match: CupBracketMatchSummarySchema.nullable()
});

export const CupBracketViewSchema = z.object({
  competitionId: ResourceIdSchema,
  proposalId: ResourceIdSchema,
  proposalVersion: z.number().int().positive(),
  proposalStatus: CupProposalStatusSchema,
  bracketSize: z.number().int().min(2).max(128),
  currentRoundNumber: z.number().int().positive().nullable(),
  rounds: z.array(z.object({
    stageId: ResourceIdSchema.nullable(),
    roundNumber: z.number().int().positive(),
    stageCode: CompetitionStageCodeSchema,
    displayName: z.string().trim().min(1).max(64),
    status: z.enum(['DRAFT', 'PUBLISHED']),
    pairings: z.array(CupBracketViewPairingSchema).min(1)
  })).min(1)
});

export const CancelCompetitionRequestSchema = VersionedMutationRequestSchema.extend({
  reason: z.string().trim().min(1).max(512)
});

export const SubmitMatchResultRequestSchema = z.object({
  homeScore: ScoreSchema,
  awayScore: ScoreSchema,
  expectedVersion: ExpectedVersionSchema
});

export const RejectMatchResultRequestSchema = VersionedMutationRequestSchema.extend({
  reason: z.string().trim().min(1).max(512)
});

export const ManagerMatchResultRequestSchema = SubmitMatchResultRequestSchema.extend({
  reason: z.string().trim().min(1).max(512).nullable().optional()
});

export const CompetitionListQuerySchema = z.object({
  status: CompetitionStatusSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const MyCompetitionListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const MyMatchListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const CompetitionRegistrationResponseSchema = z.object({
  id: ResourceIdSchema,
  competitionId: ResourceIdSchema,
  applicantId: ResourceIdSchema,
  applicantDisplayName: z.string().optional(),
  gameAccountId: ResourceIdSchema,
  gameAccountGamerTag: z.string().optional(),
  acceptedRuleVersion: z.number().int().positive(),
  status: CompetitionRegistrationStatusSchema,
  reviewReason: z.string().nullable(),
  reviewedAt: TimestampSchema.nullable(),
  withdrawnAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const CompetitionSummarySchema = z.object({
  id: ResourceIdSchema,
  seasonId: ResourceIdSchema.nullable().optional(),
  competitionType: CompetitionTypeSchema.optional(),
  name: z.string(),
  description: z.string(),
  platform: GamePlatformSchema,
  serverRegion: z.string(),
  participantType: CompetitionParticipantTypeSchema,
  format: CompetitionFormatSchema,
  status: CompetitionStatusSchema,
  registrationOpensAt: TimestampSchema,
  registrationClosesAt: TimestampSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  participantLimit: z.number().int().positive(),
  participantCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  activeRuleVersion: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const CompetitionCapabilitiesSchema = z.object({
  canRegister: z.boolean(),
  canWithdraw: z.boolean(),
  canManage: z.boolean(),
  canReviewRegistrations: z.boolean(),
  canManageSchedule: z.boolean(),
  canManageResults: z.boolean()
});

export const CompetitionScheduleMetadataSchema = z.object({
  published: z.boolean(),
  matchCount: z.number().int().nonnegative(),
  roundCount: z.number().int().nonnegative()
});

export const CompetitionDetailSchema = CompetitionSummarySchema.extend({
  currentRegistration: CompetitionRegistrationResponseSchema.nullable(),
  rules: CompetitionRulesSchema,
  schedule: CompetitionScheduleMetadataSchema,
  capabilities: CompetitionCapabilitiesSchema
});

export const CompetitionParticipantSummarySchema = z.object({
  id: ResourceIdSchema,
  displayName: z.string(),
  participantType: CompetitionParticipantTypeSchema
});

export const CompetitionStageSummarySchema = z.object({
  id: ResourceIdSchema,
  competitionId: ResourceIdSchema,
  stageCode: CompetitionStageCodeSchema,
  displayName: z.string().trim().min(1).max(64),
  sequence: z.number().int().positive(),
  capacity: z.number().int().positive(),
  format: CompetitionFormatSchema,
  status: z.enum(['DRAFT', 'PUBLISHED']),
  participantCount: z.number().int().nonnegative(),
  version: z.number().int().positive()
});

export const MatchResultVersionResponseSchema = z.object({
  id: ResourceIdSchema,
  matchId: ResourceIdSchema,
  version: z.number().int().positive(),
  homeScore: ScoreSchema,
  awayScore: ScoreSchema,
  status: MatchResultVersionStatusSchema,
  submissionSide: MatchResultSubmissionSideSchema,
  submittedByMe: z.boolean(),
  reason: z.string().nullable(),
  createdAt: TimestampSchema
});

export const OfficialResultSummarySchema = z.object({
  resultVersionId: ResourceIdSchema,
  version: z.number().int().positive(),
  homeScore: ScoreSchema,
  awayScore: ScoreSchema,
  status: z.enum(['OFFICIAL', 'SUPERSEDED'])
});

export const CompetitionMatchResponseSchema = z.object({
  id: ResourceIdSchema,
  competitionId: ResourceIdSchema,
  stageId: ResourceIdSchema,
  roundNumber: z.number().int().positive(),
  matchNumber: z.number().int().positive(),
  homeParticipant: CompetitionParticipantSummarySchema,
  awayParticipant: CompetitionParticipantSummarySchema,
  plannedAt: TimestampSchema.nullable(),
  status: CompetitionMatchStatusSchema,
  version: z.number().int().positive(),
  officialResult: OfficialResultSummarySchema.nullable(),
  resultVersions: z.array(MatchResultVersionResponseSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const StandingsRowResponseSchema = z.object({
  participantId: ResourceIdSchema,
  displayName: z.string(),
  played: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  goalsFor: z.number().int().nonnegative(),
  goalsAgainst: z.number().int().nonnegative(),
  goalDifference: z.number().int(),
  basePoints: z.number().int(),
  adjustmentPoints: z.number().int(),
  totalPoints: z.number().int(),
  rank: z.number().int().positive(),
  tiePending: z.boolean(),
  tieBreakValues: z.record(z.string(), z.number())
});

export const StandingsSnapshotResponseSchema = z.object({
  competitionId: ResourceIdSchema,
  stageId: ResourceIdSchema.nullable().optional(),
  version: z.number().int().nonnegative(),
  ruleVersion: z.number().int().positive(),
  triggeringResultVersionId: ResourceIdSchema.nullable(),
  generatedAt: TimestampSchema.nullable(),
  rows: z.array(StandingsRowResponseSchema)
});

export const CompetitionListResponseSchema = z.object({
  items: z.array(CompetitionSummarySchema),
  nextCursor: z.string().nullable()
});

export const CompetitionMatchListResponseSchema = z.object({
  items: z.array(CompetitionMatchResponseSchema),
  nextCursor: z.string().nullable()
});

export const MyCompetitionResponseSchema = z.object({
  competition: CompetitionSummarySchema,
  registration: z.union([CompetitionRegistrationResponseSchema, CupRegistrationResponseSchema]),
  nextMatch: CompetitionMatchResponseSchema.nullable()
});

export const MyCompetitionListResponseSchema = z.object({
  items: z.array(MyCompetitionResponseSchema),
  nextCursor: z.string().nullable()
});

export const MyMatchActionSchema = z.enum(['SUBMIT', 'CONFIRM', 'WAIT', 'DONE']);
export const MyMatchResponseSchema = z.object({
  match: CompetitionMatchResponseSchema,
  competition: CompetitionSummarySchema,
  myParticipantId: ResourceIdSchema,
  action: MyMatchActionSchema,
  actionableResultVersion: MatchResultVersionResponseSchema.nullable()
});

export const MyMatchListResponseSchema = z.object({
  items: z.array(MyMatchResponseSchema),
  nextCursor: z.string().nullable()
});

export type CompetitionStatus = z.infer<typeof CompetitionStatusSchema>;
export type CompetitionParticipantType = z.infer<typeof CompetitionParticipantTypeSchema>;
export type CompetitionType = z.infer<typeof CompetitionTypeSchema>;
export type CompetitionFormat = z.infer<typeof CompetitionFormatSchema>;
export type CompetitionStageCode = z.infer<typeof CompetitionStageCodeSchema>;
export type CompetitionRegistrationStatus = z.infer<typeof CompetitionRegistrationStatusSchema>;
export type CompetitionMatchStatus = z.infer<typeof CompetitionMatchStatusSchema>;
export type MatchResultVersionStatus = z.infer<typeof MatchResultVersionStatusSchema>;
export type CompetitionTieBreaker = z.infer<typeof CompetitionTieBreakerSchema>;
export type CreateCompetitionRequest = z.input<typeof CreateCompetitionRequestSchema>;
export type ParsedCreateCompetitionRequest = z.output<typeof CreateCompetitionRequestSchema>;
export type CreateSeasonCupRequest = z.input<typeof CreateSeasonCupRequestSchema>;
export type ParsedCreateSeasonCupRequest = z.output<typeof CreateSeasonCupRequestSchema>;
export type RegisterSeasonCupRequest = z.input<typeof RegisterSeasonCupRequestSchema>;
export type WithdrawSeasonCupRequest = z.infer<typeof WithdrawSeasonCupRequestSchema>;
export type CupRegistrationResponse = z.infer<typeof CupRegistrationResponseSchema>;
export type SeasonCupSummary = z.infer<typeof SeasonCupSummarySchema>;
export type SeasonCupListResponse = z.infer<typeof SeasonCupListResponseSchema>;
export type UpdateCompetitionRequest = z.input<typeof UpdateCompetitionRequestSchema>;
export type UpdateCompetitionRulesRequest = z.input<typeof UpdateCompetitionRulesRequestSchema>;
export type RegisterCompetitionRequest = z.input<typeof RegisterCompetitionRequestSchema>;
export type ReviewRegistrationRequest = z.input<typeof ReviewRegistrationRequestSchema>;
export type VersionedMutationRequest = z.input<typeof VersionedMutationRequestSchema>;
export type GenerateStageScheduleRequest = z.infer<typeof GenerateStageScheduleRequestSchema>;
export type PublishStageScheduleRequest = z.infer<typeof PublishStageScheduleRequestSchema>;
export type GenerateCupGroupProposalRequest = z.infer<typeof GenerateCupGroupProposalRequestSchema>;
export type ConfirmCupGroupProposalRequest = z.infer<typeof ConfirmCupGroupProposalRequestSchema>;
export type CupGroupProposal = z.infer<typeof CupGroupProposalSchema>;
export type GenerateCupBracketProposalRequest = z.infer<typeof GenerateCupBracketProposalRequestSchema>;
export type ConfirmCupBracketProposalRequest = z.infer<typeof ConfirmCupBracketProposalRequestSchema>;
export type CupBracketProposal = z.infer<typeof CupBracketProposalSchema>;
export type CupBracketView = z.infer<typeof CupBracketViewSchema>;
export type SubmitMatchResultRequest = z.input<typeof SubmitMatchResultRequestSchema>;
export type RejectMatchResultRequest = z.input<typeof RejectMatchResultRequestSchema>;
export type ManagerMatchResultRequest = z.input<typeof ManagerMatchResultRequestSchema>;
export type CompetitionListQuery = z.output<typeof CompetitionListQuerySchema>;
export type MyCompetitionListQuery = z.output<typeof MyCompetitionListQuerySchema>;
export type MyMatchListQuery = z.output<typeof MyMatchListQuerySchema>;
export type CompetitionRules = z.infer<typeof CompetitionRulesSchema>;
export type CompetitionSummary = z.infer<typeof CompetitionSummarySchema>;
export type CompetitionDetail = z.infer<typeof CompetitionDetailSchema>;
export type CompetitionListResponse = z.infer<typeof CompetitionListResponseSchema>;
export type CompetitionMatchListResponse = z.infer<typeof CompetitionMatchListResponseSchema>;
export type CompetitionRegistrationResponse = z.infer<typeof CompetitionRegistrationResponseSchema>;
export type CompetitionStageSummary = z.infer<typeof CompetitionStageSummarySchema>;
export type CompetitionMatchResponse = z.infer<typeof CompetitionMatchResponseSchema>;
export type MatchResultVersionResponse = z.infer<typeof MatchResultVersionResponseSchema>;
export type StandingsSnapshotResponse = z.infer<typeof StandingsSnapshotResponseSchema>;
export type MyCompetitionResponse = z.infer<typeof MyCompetitionResponseSchema>;
export type MyCompetitionListResponse = z.infer<typeof MyCompetitionListResponseSchema>;
export type MyMatchResponse = z.infer<typeof MyMatchResponseSchema>;
export type MyMatchListResponse = z.infer<typeof MyMatchListResponseSchema>;
