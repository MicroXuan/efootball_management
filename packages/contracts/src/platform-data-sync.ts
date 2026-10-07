import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { ImportBatchSchema, ImportRecordSchema } from './player-import.js';
import { TeamCatalogSyncDifferenceSchema } from './team-catalog.js';

const TimestampSchema = z.iso.datetime();
const NonNegativeCountSchema = z.number().int().nonnegative();

export const PlatformSyncKindSchema = z.enum(['PLAYER_CARDS', 'TEAM_SHELLS']);
export const PlatformSyncModeSchema = z.enum(['SAMPLE', 'FULL', 'INCREMENTAL', 'RESUME']);
export const PlatformSyncStatusSchema = z.enum(['PENDING', 'RUNNING', 'READY', 'PAUSED', 'FAILED']);
export const StartPlatformSyncRequestSchema = z.object({
  mode: z.enum(['sample', 'incremental', 'full']),
  limit: z.number().int().min(1).max(5_000).optional()
}).superRefine((value, context) => {
  if (value.mode !== 'sample' && value.limit !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['limit'],
      message: 'A limit is only supported for sample synchronization'
    });
  }
});

const StringListSchema = z.union([
  z.string().trim().min(1).max(64).transform((value) => value.split(',').map((entry) => entry.trim()).filter(Boolean)),
  z.array(z.string().trim().min(1).max(64)).max(16)
]).transform((values) => [...new Set(values)]);

export const PlatformPageRequestSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(20), z.literal(50)])).default(20),
  status: StringListSchema.optional(),
  changeType: StringListSchema.optional(),
  errorCode: z.string().trim().min(1).max(128).optional(),
  sourceLeagueId: z.string().trim().min(1).max(128).optional(),
  query: z.string().trim().max(128).optional(),
  sortBy: z.string().trim().min(1).max(32).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

export const PlatformSyncCountersSchema = z.object({
  sourceTotal: NonNegativeCountSchema.nullable(),
  scanned: NonNegativeCountSchema,
  fetched: NonNegativeCountSchema,
  skipped: NonNegativeCountSchema,
  added: NonNegativeCountSchema,
  updated: NonNegativeCountSchema,
  missing: NonNegativeCountSchema,
  failed: NonNegativeCountSchema,
  batches: NonNegativeCountSchema
});

export const PlatformSyncRunSummarySchema = z.object({
  id: ResourceIdSchema,
  kind: PlatformSyncKindSchema,
  mode: PlatformSyncModeSchema,
  status: PlatformSyncStatusSchema,
  actorAdminId: ResourceIdSchema,
  currentPhase: z.string().trim().min(1).max(64).nullable(),
  heartbeatAt: TimestampSchema.nullable(),
  leaseExpiresAt: TimestampSchema.nullable(),
  resumable: z.boolean(),
  counters: PlatformSyncCountersSchema,
  errorCode: z.string().max(128).nullable(),
  errorMessage: z.string().max(512).nullable(),
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const PlatformSyncRunStatusSummarySchema = z.object({
  pending: NonNegativeCountSchema,
  running: NonNegativeCountSchema,
  ready: NonNegativeCountSchema,
  paused: NonNegativeCountSchema,
  failed: NonNegativeCountSchema
});

export const PlatformSyncRunPageSchema = z.object({
  items: z.array(PlatformSyncRunSummarySchema),
  page: z.number().int().positive(),
  pageSize: z.union([z.literal(20), z.literal(50)]),
  total: NonNegativeCountSchema,
  summary: PlatformSyncRunStatusSummarySchema
});

export const PlatformSyncOverviewSectionSchema = z.object({
  activeRun: PlatformSyncRunSummarySchema.nullable(),
  pendingReview: NonNegativeCountSchema,
  failedReview: NonNegativeCountSchema,
  published: NonNegativeCountSchema,
  lastCompletedAt: TimestampSchema.nullable()
});

export const PlatformDataSyncOverviewSchema = z.object({
  players: PlatformSyncOverviewSectionSchema,
  teams: PlatformSyncOverviewSectionSchema
});

export const PlayerSyncBatchSummarySchema = z.object({
  uploaded: NonNegativeCountSchema,
  validated: NonNegativeCountSchema,
  ready: NonNegativeCountSchema,
  published: NonNegativeCountSchema,
  failed: NonNegativeCountSchema,
  cancelled: NonNegativeCountSchema
});

export const PlayerSyncBatchPageSchema = z.object({
  items: z.array(ImportBatchSchema),
  page: z.number().int().positive(),
  pageSize: z.union([z.literal(20), z.literal(50)]),
  total: NonNegativeCountSchema,
  summary: PlayerSyncBatchSummarySchema
});

export const PlayerImportRecordSummarySchema = z.object({
  create: NonNegativeCountSchema,
  update: NonNegativeCountSchema,
  unchanged: NonNegativeCountSchema,
  invalid: NonNegativeCountSchema
});

export const PlayerImportRecordPageSchema = z.object({
  items: z.array(ImportRecordSchema),
  page: z.number().int().positive(),
  pageSize: z.union([z.literal(20), z.literal(50)]),
  total: NonNegativeCountSchema,
  summary: PlayerImportRecordSummarySchema
});

export const PlatformTeamSyncItemSchema = TeamCatalogSyncDifferenceSchema.extend({
  errorMessage: z.string().max(512).nullable()
});

export const TeamSyncItemSummarySchema = z.object({
  pending: NonNegativeCountSchema,
  failed: NonNegativeCountSchema,
  published: NonNegativeCountSchema,
  rejected: NonNegativeCountSchema,
  errors: z.array(z.object({
    code: z.string().trim().min(1).max(128),
    count: NonNegativeCountSchema
  }))
});

export const TeamSyncItemPageSchema = z.object({
  items: z.array(PlatformTeamSyncItemSchema),
  page: z.number().int().positive(),
  pageSize: z.union([z.literal(20), z.literal(50)]),
  total: NonNegativeCountSchema,
  summary: TeamSyncItemSummarySchema
});

export const BatchMutationRequestSchema = z.object({
  ids: z.array(ResourceIdSchema).min(1).max(100)
}).superRefine((value, context) => {
  if (new Set(value.ids).size !== value.ids.length) {
    context.addIssue({ code: 'custom', path: ['ids'], message: 'Resource IDs must be unique' });
  }
});

export const BatchMutationFailureSchema = z.object({
  id: ResourceIdSchema,
  code: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(512)
});

export const BatchMutationResultSchema = z.object({
  requestedCount: NonNegativeCountSchema,
  succeededIds: z.array(ResourceIdSchema),
  failed: z.array(BatchMutationFailureSchema)
}).superRefine((value, context) => {
  if (value.succeededIds.length + value.failed.length !== value.requestedCount) {
    context.addIssue({ code: 'custom', message: 'Every requested resource must have an outcome' });
  }
});

export const QueuedSyncRunSchema = z.object({
  runId: ResourceIdSchema,
  status: z.literal('PENDING')
});

export type PlatformSyncKind = z.infer<typeof PlatformSyncKindSchema>;
export type PlatformSyncMode = z.infer<typeof PlatformSyncModeSchema>;
export type PlatformSyncStatus = z.infer<typeof PlatformSyncStatusSchema>;
export type StartPlatformSyncRequest = z.infer<typeof StartPlatformSyncRequestSchema>;
export type PlatformPageRequest = z.infer<typeof PlatformPageRequestSchema>;
export type PlatformSyncRunSummary = z.infer<typeof PlatformSyncRunSummarySchema>;
export type PlatformSyncRunPage = z.infer<typeof PlatformSyncRunPageSchema>;
export type PlatformDataSyncOverview = z.infer<typeof PlatformDataSyncOverviewSchema>;
export type PlayerSyncBatchPage = z.infer<typeof PlayerSyncBatchPageSchema>;
export type PlayerImportRecordPage = z.infer<typeof PlayerImportRecordPageSchema>;
export type TeamSyncItemPage = z.infer<typeof TeamSyncItemPageSchema>;
export type BatchMutationRequest = z.infer<typeof BatchMutationRequestSchema>;
export type BatchMutationResult = z.infer<typeof BatchMutationResultSchema>;
export type QueuedSyncRun = z.infer<typeof QueuedSyncRunSchema>;
