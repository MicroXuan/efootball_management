import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { ExpectedVersionSchema } from './competition.js';

const TimestampSchema = z.iso.datetime();
const NonNegativeMoneyMinorSchema = z.number().int().nonnegative();
const OwnerAliasSchema = z.string().trim().min(1).max(32);

export const PublicUserNumberSchema = z.string().regex(/^\d{6}$/);
export const TeamNumberSchema = z.number().int().min(0).max(9_999);
export const LeagueTeamStatusSchema = z.enum(['ACTIVE', 'ARCHIVED', 'NEEDS_NUMBER']);
export const LeagueTeamRosterStatusSchema = z.enum(['COMPLIANT', 'OVER_CAP']);

export const PublicUserLookupSchema = z.object({
  id: ResourceIdSchema,
  publicUserNo: PublicUserNumberSchema,
  displayName: z.string().min(1),
  avatarUrl: z.string().nullable()
});

const LeagueTeamMutableFieldsSchema = z.object({
  teamNumber: TeamNumberSchema,
  ownerAlias: OwnerAliasSchema
});

export const CreateLeagueTeamRequestSchema = LeagueTeamMutableFieldsSchema.extend({
  ownerUserId: ResourceIdSchema,
  catalogTeamId: ResourceIdSchema
});

export const UpdateLeagueTeamRequestSchema = LeagueTeamMutableFieldsSchema.partial().extend({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  shellValueMinor: NonNegativeMoneyMinorSchema.max(4_294_967_295).optional(),
  expectedVersion: ExpectedVersionSchema
}).strict();

const ShellMutationBaseSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  reason: z.string().trim().min(1).max(512).optional()
});

export const ChangeTeamShellRequestSchema = ShellMutationBaseSchema.extend({
  catalogTeamId: ResourceIdSchema
});

export const RefreshTeamShellRequestSchema = ShellMutationBaseSchema.extend({
  catalogTeamId: ResourceIdSchema
});

export const TransferTeamShellRequestSchema = z.object({
  targetTeamId: ResourceIdSchema,
  sourceReplacementCatalogTeamId: ResourceIdSchema,
  expectedSourceVersion: ExpectedVersionSchema,
  expectedTargetVersion: ExpectedVersionSchema,
  reason: z.string().trim().min(1).max(512).optional()
});

export const SwapTeamShellRequestSchema = z.object({
  sourceTeamId: ResourceIdSchema,
  otherTeamId: ResourceIdSchema,
  expectedSourceVersion: ExpectedVersionSchema,
  expectedOtherVersion: ExpectedVersionSchema,
  reason: z.string().trim().min(1).max(512).optional()
}).refine((value) => value.sourceTeamId !== value.otherTeamId, {
  message: 'Two distinct teams are required',
  path: ['otherTeamId']
});

export const LeagueTeamSummarySchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  ownerUserId: ResourceIdSchema,
  ownerPublicUserNo: PublicUserNumberSchema,
  ownerDisplayName: z.string().min(1).optional(),
  ownerAlias: OwnerAliasSchema,
  catalogTeamId: ResourceIdSchema,
  teamNumber: TeamNumberSchema.nullable(),
  name: z.string().min(1),
  shortName: z.string().min(1),
  logoUrl: z.string().nullable(),
  status: LeagueTeamStatusSchema,
  rosterStatus: LeagueTeamRosterStatusSchema,
  activePlayerCount: z.number().int().min(0).max(25),
  salaryTotalMinor: NonNegativeMoneyMinorSchema,
  salaryCapMinor: NonNegativeMoneyMinorSchema,
  shellValueMinor: NonNegativeMoneyMinorSchema,
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const LeagueTeamDetailSchema = LeagueTeamSummarySchema.extend({
  ownerDisplayName: z.string().min(1),
  defaultGameAccountId: ResourceIdSchema.nullable(),
  participatingSeasonCount: z.number().int().nonnegative()
});

export const LeagueTeamListResponseSchema = z.object({
  items: z.array(LeagueTeamSummarySchema),
  nextCursor: z.string().nullable()
});

export type PublicUserLookup = z.infer<typeof PublicUserLookupSchema>;
export type LeagueTeamStatus = z.infer<typeof LeagueTeamStatusSchema>;
export type LeagueTeamRosterStatus = z.infer<typeof LeagueTeamRosterStatusSchema>;
export type CreateLeagueTeamRequest = z.input<typeof CreateLeagueTeamRequestSchema>;
export type ParsedCreateLeagueTeamRequest = z.output<typeof CreateLeagueTeamRequestSchema>;
export type UpdateLeagueTeamRequest = z.infer<typeof UpdateLeagueTeamRequestSchema>;
export type ChangeTeamShellRequest = z.infer<typeof ChangeTeamShellRequestSchema>;
export type RefreshTeamShellRequest = z.infer<typeof RefreshTeamShellRequestSchema>;
export type TransferTeamShellRequest = z.infer<typeof TransferTeamShellRequestSchema>;
export type SwapTeamShellRequest = z.infer<typeof SwapTeamShellRequestSchema>;
export type LeagueTeamSummary = z.infer<typeof LeagueTeamSummarySchema>;
export type LeagueTeamDetail = z.infer<typeof LeagueTeamDetailSchema>;
export type LeagueTeamListResponse = z.infer<typeof LeagueTeamListResponseSchema>;
