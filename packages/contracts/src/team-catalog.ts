import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

const TimestampSchema = z.iso.datetime();
const NullableUrlSchema = z.url().max(2_048).nullable();
const NullableSourceIdSchema = z.string().trim().min(1).max(128).nullable();

export const TeamCatalogSourceTypeSchema = z.enum(['PESDATA', 'CUSTOM']);
export const TeamCatalogStatusSchema = z.enum(['ACTIVE', 'SOURCE_UNCONFIRMED', 'DISABLED']);

export const TeamCatalogCandidateSchema = z.object({
  sourceExternalId: z.string().trim().min(1).max(128),
  sourceLeagueExternalId: NullableSourceIdSchema,
  sourceLeagueName: z.string().trim().min(1).max(128).nullable(),
  nameZh: z.string().trim().min(1).max(64).nullable(),
  nameEn: z.string().trim().min(1).max(64).nullable(),
  nameJa: z.string().trim().min(1).max(64).nullable(),
  shortName: z.string().trim().min(1).max(24),
  remoteLogoUrl: NullableUrlSchema,
  storedLogoUrl: NullableUrlSchema,
  sourceUpdatedAt: TimestampSchema.nullable()
}).refine((value) => Boolean(value.nameZh ?? value.nameEn ?? value.nameJa), {
  message: 'At least one team name is required'
});

export const TeamCatalogItemSchema = z.object({
  id: ResourceIdSchema,
  sourceType: TeamCatalogSourceTypeSchema,
  sourceExternalId: NullableSourceIdSchema,
  sourceLeagueExternalId: NullableSourceIdSchema,
  sourceLeagueName: z.string().trim().min(1).max(128).nullable(),
  nameZh: z.string().trim().min(1).max(64).nullable(),
  nameEn: z.string().trim().min(1).max(64).nullable(),
  nameJa: z.string().trim().min(1).max(64).nullable(),
  shortName: z.string().trim().min(1).max(24),
  remoteLogoUrl: NullableUrlSchema,
  storedLogoUrl: NullableUrlSchema,
  status: TeamCatalogStatusSchema,
  sourceUpdatedAt: TimestampSchema.nullable(),
  lastSyncedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  isAssigned: z.boolean(),
  assignedLeagueTeamId: ResourceIdSchema.nullable()
}).refine((value) => Boolean(value.nameZh ?? value.nameEn ?? value.nameJa), {
  message: 'At least one team name is required'
});

export const TeamCatalogListResponseSchema = z.object({
  items: z.array(TeamCatalogItemSchema),
  nextCursor: z.string().nullable()
});

export const CreateCustomTeamCatalogItemRequestSchema = z.object({
  nameZh: z.string().trim().min(1).max(64),
  nameEn: z.string().trim().min(1).max(64).nullable().optional(),
  nameJa: z.string().trim().min(1).max(64).nullable().optional(),
  shortName: z.string().trim().min(1).max(24),
  storedLogoUrl: z.url().max(2_048)
});

export const TeamCatalogSyncModeSchema = z.enum(['SAMPLE', 'FULL', 'INCREMENTAL', 'RESUME']);
export const TeamCatalogSyncRunStatusSchema = z.enum(['PENDING', 'RUNNING', 'READY', 'FAILED']);
export const TeamCatalogSyncRunSummarySchema = z.object({
  id: ResourceIdSchema,
  mode: TeamCatalogSyncModeSchema,
  status: TeamCatalogSyncRunStatusSchema,
  scannedCount: z.number().int().nonnegative(),
  addedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
  errorCode: z.string().max(128).nullable()
});

export const TeamCatalogSyncChangeTypeSchema = z.enum(['ADDED', 'UPDATED', 'SOURCE_MISSING']);
export const TeamCatalogSyncReviewStatusSchema = z.enum(['PENDING', 'PUBLISHED', 'REJECTED', 'FAILED']);
export const TeamCatalogSyncDifferenceSchema = z.object({
  id: ResourceIdSchema,
  runId: ResourceIdSchema,
  sourceExternalId: z.string().trim().min(1).max(128),
  changeType: TeamCatalogSyncChangeTypeSchema,
  reviewStatus: TeamCatalogSyncReviewStatusSchema,
  currentCatalogItemId: ResourceIdSchema.nullable(),
  candidate: TeamCatalogCandidateSchema.nullable(),
  errorCode: z.string().max(128).nullable()
});

export type TeamCatalogSourceType = z.infer<typeof TeamCatalogSourceTypeSchema>;
export type TeamCatalogStatus = z.infer<typeof TeamCatalogStatusSchema>;
export type TeamCatalogCandidate = z.infer<typeof TeamCatalogCandidateSchema>;
export type TeamCatalogItem = z.infer<typeof TeamCatalogItemSchema>;
export type TeamCatalogListResponse = z.infer<typeof TeamCatalogListResponseSchema>;
export type CreateCustomTeamCatalogItemRequest = z.infer<typeof CreateCustomTeamCatalogItemRequestSchema>;
export type TeamCatalogSyncRunSummary = z.infer<typeof TeamCatalogSyncRunSummarySchema>;
export type TeamCatalogSyncDifference = z.infer<typeof TeamCatalogSyncDifferenceSchema>;
