import { z } from 'zod';
import { ExpectedVersionSchema, ResourceIdSchema } from './common.js';

const TimestampSchema = z.iso.datetime();
const ScoreSchema = z.number().int().min(0).max(99);
const ChecksumSchema = z.string().regex(/^[a-f\d]{64}$/i);

export const MatchResultDisputeStatusSchema = z.enum([
  'EVIDENCE_COLLECTION', 'READY_FOR_REVIEW', 'RESOLVED', 'CANCELLED'
]);
export const MatchResultDisputeTriggerSchema = z.enum(['REJECTED', 'CONFIRMATION_TIMEOUT']);
export const MatchResultDecisionTypeSchema = z.enum(['USE_SUBMITTED_SCORE', 'REPLACE_SCORE']);
export const MatchResultEvidenceRoleSchema = z.enum(['SUBMITTER', 'OPPONENT', 'ADMIN']);
export const MatchResultEvidenceStatusSchema = z.enum(['ACTIVE', 'PENDING_DELETE', 'DELETED']);
export const MatchResultEvidenceUploadStatusSchema = z.enum(['PENDING', 'UPLOADED', 'CONSUMED', 'EXPIRED']);
export const MatchResultEventTypeSchema = z.enum([
  'RESULT_SUBMITTED', 'RESULT_CONFIRMED', 'RESULT_REJECTED', 'CONFIRMATION_EXPIRED',
  'DISPUTE_OPENED', 'EVIDENCE_UPLOADED', 'EVIDENCE_REPLACED',
  'EVIDENCE_DEADLINE_EXPIRED', 'ADMIN_DECIDED', 'EVIDENCE_DELETED'
]);
export const MatchResultEventActorTypeSchema = z.enum(['USER', 'ADMIN', 'SYSTEM']);

export const MatchResultEvidenceResponseSchema = z.object({
  id: ResourceIdSchema,
  matchId: ResourceIdSchema,
  disputeId: ResourceIdSchema.nullable(),
  resultVersionId: ResourceIdSchema.nullable(),
  role: MatchResultEvidenceRoleSchema,
  status: MatchResultEvidenceStatusSchema,
  uploadedByUserId: ResourceIdSchema.nullable(),
  uploadedByAdminId: ResourceIdSchema.nullable(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteSize: z.number().int().positive().max(1_048_576),
  checksumSha256: ChecksumSchema,
  expiresAt: TimestampSchema.nullable(),
  deletedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema
});

export const MatchResultTimelineEventSchema = z.object({
  id: ResourceIdSchema,
  matchId: ResourceIdSchema,
  disputeId: ResourceIdSchema.nullable(),
  resultVersionId: ResourceIdSchema.nullable(),
  type: MatchResultEventTypeSchema,
  actorType: MatchResultEventActorTypeSchema,
  actorUserId: ResourceIdSchema.nullable(),
  actorAdminId: ResourceIdSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: TimestampSchema
});

export const MatchResultDisputeResponseSchema = z.object({
  id: ResourceIdSchema,
  matchId: ResourceIdSchema,
  triggerResultVersionId: ResourceIdSchema,
  trigger: MatchResultDisputeTriggerSchema,
  status: MatchResultDisputeStatusSchema,
  openedByUserId: ResourceIdSchema,
  evidenceDeadlineAt: TimestampSchema,
  decidedByAdminId: ResourceIdSchema.nullable(),
  decisionType: MatchResultDecisionTypeSchema.nullable(),
  finalHomeScore: ScoreSchema.nullable(),
  finalAwayScore: ScoreSchema.nullable(),
  decisionReason: z.string().nullable(),
  decidedAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  evidence: z.array(MatchResultEvidenceResponseSchema).default([]),
  timeline: z.array(MatchResultTimelineEventSchema).default([])
});

// Administrator mutations use the match token, independently of the dispute's own version.
export const AdminMatchResultDisputeResponseSchema = MatchResultDisputeResponseSchema.extend({
  matchVersion: ExpectedVersionSchema
});
export const AdminMatchResultDisputeListResponseSchema = z.array(AdminMatchResultDisputeResponseSchema);

// Participant-facing projection: no evidence metadata or administrator timeline.
export const ParticipantMatchResultDisputeResponseSchema = z.object({
  id: ResourceIdSchema,
  matchId: ResourceIdSchema,
  trigger: MatchResultDisputeTriggerSchema,
  status: MatchResultDisputeStatusSchema,
  evidenceDeadlineAt: TimestampSchema,
  matchVersion: z.number().int().positive(),
  evidencePresence: z.object({ SUBMITTER: z.boolean(), OPPONENT: z.boolean() })
});

export const CreateEvidenceUploadRequestSchema = z.object({
  role: MatchResultEvidenceRoleSchema,
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteSize: z.number().int().positive().max(1_048_576),
  checksumSha256: ChecksumSchema,
  expectedVersion: ExpectedVersionSchema
});

export const CreateEvidenceUploadResponseSchema = z.object({
  id: ResourceIdSchema,
  objectKey: z.string().min(1),
  uploadUrl: z.url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: TimestampSchema
});

export const CompleteEvidenceUploadRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema
});

export const OpenTimeoutDisputeRequestSchema = z.object({
  evidenceUploadId: ResourceIdSchema,
  expectedVersion: ExpectedVersionSchema
});

export const AdminResolveMatchResultDisputeRequestSchema = z.discriminatedUnion('decisionType', [
  z.strictObject({
    decisionType: z.literal('USE_SUBMITTED_SCORE'),
    reason: z.string().trim().min(1).max(512),
    evidenceUploadId: ResourceIdSchema.optional(),
    expectedVersion: ExpectedVersionSchema
  }),
  z.strictObject({
    decisionType: z.literal('REPLACE_SCORE'),
    homeScore: ScoreSchema,
    awayScore: ScoreSchema,
    reason: z.string().trim().min(1).max(512),
    evidenceUploadId: ResourceIdSchema.optional(),
    expectedVersion: ExpectedVersionSchema
  })
]);

export type MatchResultDisputeStatus = z.infer<typeof MatchResultDisputeStatusSchema>;
export type MatchResultDisputeTrigger = z.infer<typeof MatchResultDisputeTriggerSchema>;
export type MatchResultDecisionType = z.infer<typeof MatchResultDecisionTypeSchema>;
export type MatchResultEvidenceRole = z.infer<typeof MatchResultEvidenceRoleSchema>;
export type MatchResultEvidenceStatus = z.infer<typeof MatchResultEvidenceStatusSchema>;
export type MatchResultEvidenceUploadStatus = z.infer<typeof MatchResultEvidenceUploadStatusSchema>;
export type MatchResultEventType = z.infer<typeof MatchResultEventTypeSchema>;
export type MatchResultEventActorType = z.infer<typeof MatchResultEventActorTypeSchema>;
export type MatchResultEvidenceResponse = z.infer<typeof MatchResultEvidenceResponseSchema>;
export type MatchResultTimelineEvent = z.infer<typeof MatchResultTimelineEventSchema>;
export type MatchResultDisputeResponse = z.infer<typeof MatchResultDisputeResponseSchema>;
export type AdminMatchResultDisputeResponse = z.infer<typeof AdminMatchResultDisputeResponseSchema>;
export type AdminMatchResultDisputeListResponse = z.infer<typeof AdminMatchResultDisputeListResponseSchema>;
export type ParticipantMatchResultDisputeResponse = z.infer<typeof ParticipantMatchResultDisputeResponseSchema>;
export type CreateEvidenceUploadRequest = z.input<typeof CreateEvidenceUploadRequestSchema>;
export type CreateEvidenceUploadResponse = z.infer<typeof CreateEvidenceUploadResponseSchema>;
export type CompleteEvidenceUploadRequest = z.infer<typeof CompleteEvidenceUploadRequestSchema>;
export type OpenTimeoutDisputeRequest = z.infer<typeof OpenTimeoutDisputeRequestSchema>;
export type AdminResolveMatchResultDisputeRequest = z.infer<typeof AdminResolveMatchResultDisputeRequestSchema>;
