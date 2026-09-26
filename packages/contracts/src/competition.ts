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
  registration: CompetitionRegistrationResponseSchema,
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
export type CompetitionFormat = z.infer<typeof CompetitionFormatSchema>;
export type CompetitionRegistrationStatus = z.infer<typeof CompetitionRegistrationStatusSchema>;
export type CompetitionMatchStatus = z.infer<typeof CompetitionMatchStatusSchema>;
export type MatchResultVersionStatus = z.infer<typeof MatchResultVersionStatusSchema>;
export type CompetitionTieBreaker = z.infer<typeof CompetitionTieBreakerSchema>;
export type CreateCompetitionRequest = z.input<typeof CreateCompetitionRequestSchema>;
export type ParsedCreateCompetitionRequest = z.output<typeof CreateCompetitionRequestSchema>;
export type UpdateCompetitionRequest = z.input<typeof UpdateCompetitionRequestSchema>;
export type UpdateCompetitionRulesRequest = z.input<typeof UpdateCompetitionRulesRequestSchema>;
export type RegisterCompetitionRequest = z.input<typeof RegisterCompetitionRequestSchema>;
export type ReviewRegistrationRequest = z.input<typeof ReviewRegistrationRequestSchema>;
export type VersionedMutationRequest = z.input<typeof VersionedMutationRequestSchema>;
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
export type CompetitionMatchResponse = z.infer<typeof CompetitionMatchResponseSchema>;
export type MatchResultVersionResponse = z.infer<typeof MatchResultVersionResponseSchema>;
export type StandingsSnapshotResponse = z.infer<typeof StandingsSnapshotResponseSchema>;
export type MyCompetitionResponse = z.infer<typeof MyCompetitionResponseSchema>;
export type MyCompetitionListResponse = z.infer<typeof MyCompetitionListResponseSchema>;
export type MyMatchResponse = z.infer<typeof MyMatchResponseSchema>;
export type MyMatchListResponse = z.infer<typeof MyMatchListResponseSchema>;
