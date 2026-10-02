import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { ExpectedVersionSchema, IdempotencyKeySchema } from './competition.js';
import { RosterEntryStatusSchema } from './league-roster.js';

const TimestampSchema = z.iso.datetime();
const MAX_UNSIGNED_INT = 4_294_967_295;

export const ValuationMoneyMinorSchema = z.number().int().nonnegative().max(MAX_UNSIGNED_INT);
export const BasisPointsSchema = z.number().int().min(0).max(10_000);
export const ValuationWindowStateSchema = z.enum(['SCHEDULED', 'OPEN', 'CLOSED']);
export const ValuationSubmissionStatusSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED'
]);

const ValuationRuleFieldsSchema = z.object({
  minimumValueMinor: ValuationMoneyMinorSchema,
  maximumValueMinor: ValuationMoneyMinorSchema,
  maximumIncreaseBps: BasisPointsSchema,
  maximumDecreaseBps: BasisPointsSchema
}).refine((rule) => rule.minimumValueMinor <= rule.maximumValueMinor, {
  path: ['maximumValueMinor'],
  message: 'maximumValueMinor must be at or above minimumValueMinor'
});

export const ValuationWindowRuleVersionSchema = ValuationRuleFieldsSchema.and(z.object({
  id: ResourceIdSchema,
  windowId: ResourceIdSchema,
  version: z.number().int().positive(),
  createdByAdminId: ResourceIdSchema,
  createdAt: TimestampSchema
}));

export const ValuationWindowSchema = z.object({
  id: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  name: z.string().trim().min(1).max(64),
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  closedAt: TimestampSchema.nullable(),
  state: ValuationWindowStateSchema,
  currentRule: ValuationWindowRuleVersionSchema,
  createdByAdminId: ResourceIdSchema,
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
}).refine((window) => Date.parse(window.startsAt) < Date.parse(window.endsAt), {
  path: ['endsAt'],
  message: 'endsAt must be later than startsAt'
});

export const ValuationWindowListResponseSchema = z.object({
  items: z.array(ValuationWindowSchema)
});

export const CreateValuationWindowRequestSchema = z.object({
  name: z.string().trim().min(1).max(64),
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  rule: ValuationRuleFieldsSchema,
  idempotencyKey: IdempotencyKeySchema
}).refine((window) => Date.parse(window.startsAt) < Date.parse(window.endsAt), {
  path: ['endsAt'],
  message: 'endsAt must be later than startsAt'
});

export const UpdateValuationWindowRequestSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  startsAt: TimestampSchema.optional(),
  endsAt: TimestampSchema.optional(),
  rule: ValuationRuleFieldsSchema.optional(),
  close: z.boolean().optional(),
  expectedVersion: ExpectedVersionSchema,
  idempotencyKey: IdempotencyKeySchema
});

export const ValuationWorkspaceWindowSchema = z.object({
  id: ResourceIdSchema,
  name: z.string().min(1),
  state: ValuationWindowStateSchema,
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  rule: ValuationRuleFieldsSchema.and(z.object({
    id: ResourceIdSchema,
    version: z.number().int().positive()
  }))
});

export const ValuationSubmissionSummarySchema = z.object({
  id: ResourceIdSchema,
  windowId: ResourceIdSchema,
  leagueTeamId: ResourceIdSchema,
  ruleVersionId: ResourceIdSchema,
  attemptNumber: z.number().int().positive(),
  status: ValuationSubmissionStatusSchema,
  submittedAt: TimestampSchema.nullable(),
  reviewedAt: TimestampSchema.nullable(),
  reviewReason: z.string().nullable(),
  version: z.number().int().positive()
});

export const ValuationWorkspacePlayerSchema = z.object({
  snapshotId: ResourceIdSchema,
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  cardName: z.string().min(1),
  cardImageUrl: z.string().nullable(),
  rosterStatus: RosterEntryStatusSchema,
  baseValueMinor: ValuationMoneyMinorSchema.nullable(),
  currentValueMinor: ValuationMoneyMinorSchema.nullable(),
  minimumAllowedMinor: ValuationMoneyMinorSchema,
  maximumAllowedMinor: ValuationMoneyMinorSchema,
  draftValueMinor: ValuationMoneyMinorSchema.nullable(),
  exceedsRange: z.boolean()
});

export const ValuationWorkspaceSchema = z.object({
  window: ValuationWorkspaceWindowSchema,
  team: z.object({ id: ResourceIdSchema, name: z.string().min(1) }),
  submission: ValuationSubmissionSummarySchema.nullable(),
  players: z.array(ValuationWorkspacePlayerSchema)
});

export const SaveValuationDraftItemSchema = z.object({
  snapshotId: ResourceIdSchema,
  proposedValueMinor: ValuationMoneyMinorSchema
});

export const SaveValuationDraftRequestSchema = z.object({
  windowId: ResourceIdSchema,
  expectedVersion: ExpectedVersionSchema,
  items: z.array(SaveValuationDraftItemSchema).min(1)
}).superRefine((request, context) => {
  const seen = new Set<string>();
  request.items.forEach((item, index) => {
    if (seen.has(item.snapshotId)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'snapshotId'],
        message: 'snapshotId must be unique'
      });
    }
    seen.add(item.snapshotId);
  });
});

export const PublishValuationSubmissionRequestSchema = z.object({
  windowId: ResourceIdSchema,
  expectedVersion: ExpectedVersionSchema,
  idempotencyKey: IdempotencyKeySchema
});

export const ReviewValuationSubmissionRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  idempotencyKey: IdempotencyKeySchema,
  reason: z.string().trim().min(1).max(512)
});

export const ValuationSubmissionItemSchema = z.object({
  snapshotId: ResourceIdSchema,
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  baseValueMinor: ValuationMoneyMinorSchema.nullable(),
  proposedValueMinor: ValuationMoneyMinorSchema,
  minimumAllowedMinor: ValuationMoneyMinorSchema,
  maximumAllowedMinor: ValuationMoneyMinorSchema,
  exceedsRange: z.boolean()
});

export const ValuationSubmissionDetailSchema = ValuationSubmissionSummarySchema.extend({
  teamName: z.string().min(1),
  windowName: z.string().min(1),
  submittedByDisplayName: z.string().min(1),
  reviewedByDisplayName: z.string().nullable(),
  items: z.array(ValuationSubmissionItemSchema)
});

export const ValuationSubmissionListResponseSchema = z.object({
  items: z.array(ValuationSubmissionDetailSchema),
  nextCursor: z.string().nullable()
});

export type BasisPoints = z.infer<typeof BasisPointsSchema>;
export type ValuationWindowState = z.infer<typeof ValuationWindowStateSchema>;
export type ValuationSubmissionStatus = z.infer<typeof ValuationSubmissionStatusSchema>;
export type ValuationWindowRuleVersion = z.infer<typeof ValuationWindowRuleVersionSchema>;
export type ValuationWindow = z.infer<typeof ValuationWindowSchema>;
export type CreateValuationWindowRequest = z.infer<typeof CreateValuationWindowRequestSchema>;
export type UpdateValuationWindowRequest = z.infer<typeof UpdateValuationWindowRequestSchema>;
export type ValuationWorkspace = z.infer<typeof ValuationWorkspaceSchema>;
export type SaveValuationDraftRequest = z.infer<typeof SaveValuationDraftRequestSchema>;
export type PublishValuationSubmissionRequest = z.infer<typeof PublishValuationSubmissionRequestSchema>;
export type ReviewValuationSubmissionRequest = z.infer<typeof ReviewValuationSubmissionRequestSchema>;
export type ValuationSubmissionSummary = z.infer<typeof ValuationSubmissionSummarySchema>;
export type ValuationSubmissionDetail = z.infer<typeof ValuationSubmissionDetailSchema>;
