import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import {
  PlayerCardStatusSchema,
  PlayerCardTypeSchema,
  PlayerPositionSchema
} from './player-catalog.js';

export const ImportFormatSchema = z.enum(['CSV', 'JSON']);
export const ImportBatchStatusSchema = z.enum([
  'UPLOADED',
  'VALIDATED',
  'READY',
  'PUBLISHED',
  'FAILED',
  'CANCELLED'
]);
export const ImportDiffTypeSchema = z.enum(['CREATE', 'UPDATE', 'UNCHANGED', 'INVALID']);

export const NormalizedPlayerCardRecordSchema = z.object({
  externalId: z.string().trim().min(1).max(128),
  playerExternalId: z.string().trim().min(1).max(128).optional(),
  playerNameZh: z.string().trim().min(1).max(128).optional(),
  playerNameEn: z.string().trim().min(1).max(128).optional(),
  playerShortName: z.string().trim().min(1).max(64).optional(),
  nationality: z.string().trim().max(64).optional(),
  club: z.string().trim().max(128).optional(),
  cardName: z.string().trim().min(1).max(128),
  position: PlayerPositionSchema,
  overallRating: z.number().int().min(1).max(110),
  cardType: PlayerCardTypeSchema,
  playStyle: z.string().trim().max(128).optional(),
  status: PlayerCardStatusSchema.default('ACTIVE'),
  imageUrl: z.url().refine((value) => value.startsWith('https://')).optional(),
  packExternalId: z.string().trim().min(1).max(128).optional(),
  packName: z.string().trim().min(1).max(128).optional(),
  season: z.string().trim().max(32).optional(),
  releaseDate: z.iso.date().optional(),
  sourceUpdatedAt: z.iso.datetime().optional(),
  skills: z.array(z.string().trim().min(1).max(128)).default([]),
  attributes: z.record(z.string(), z.number().finite()).default({})
}).refine((value) => Boolean(value.playerNameZh || value.playerNameEn), {
  message: 'At least one player name is required',
  path: ['playerNameZh']
});

export const CreateImportBatchRequestSchema = z.object({
  sourceCode: z.string().trim().min(1).max(64),
  fileName: z.string().trim().min(1).max(255),
  format: ImportFormatSchema,
  content: z.string().min(1)
});

export const ImportValidationErrorSchema = z.object({
  code: z.string().min(1),
  path: z.string(),
  message: z.string()
});

export const ImportFieldChangeSchema = z.object({
  before: z.unknown(),
  after: z.unknown()
});

export const ImportBatchSchema = z.object({
  id: ResourceIdSchema,
  sourceCode: z.string(),
  fileName: z.string(),
  format: ImportFormatSchema,
  checksum: z.string().length(64),
  status: ImportBatchStatusSchema,
  totalCount: z.number().int().nonnegative(),
  createCount: z.number().int().nonnegative(),
  updateCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative(),
  failureReason: z.string().nullable(),
  releaseId: ResourceIdSchema.nullable(),
  releaseSequence: z.number().int().positive().nullable(),
  createdBy: ResourceIdSchema,
  createdAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable()
});

export const ImportRecordSchema = z.object({
  id: ResourceIdSchema,
  batchId: ResourceIdSchema,
  rowNumber: z.number().int().positive(),
  externalId: z.string().nullable(),
  diffType: ImportDiffTypeSchema,
  raw: z.record(z.string(), z.unknown()),
  normalized: NormalizedPlayerCardRecordSchema.nullable(),
  fieldDiff: z.record(z.string(), ImportFieldChangeSchema),
  validationErrors: z.array(ImportValidationErrorSchema),
  targetPlayerId: ResourceIdSchema.nullable(),
  targetCardId: ResourceIdSchema.nullable()
});

export type ImportFormat = z.infer<typeof ImportFormatSchema>;
export type ImportBatchStatus = z.infer<typeof ImportBatchStatusSchema>;
export type ImportDiffType = z.infer<typeof ImportDiffTypeSchema>;
export type NormalizedPlayerCardRecord = z.infer<typeof NormalizedPlayerCardRecordSchema>;
export type CreateImportBatchRequest = z.input<typeof CreateImportBatchRequestSchema>;
export type ParsedCreateImportBatchRequest = z.output<typeof CreateImportBatchRequestSchema>;
export type ImportValidationError = z.infer<typeof ImportValidationErrorSchema>;
export type ImportBatchResponse = z.infer<typeof ImportBatchSchema>;
export type ImportRecordResponse = z.infer<typeof ImportRecordSchema>;
