import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { ExpectedVersionSchema } from './competition.js';

const TimestampSchema = z.iso.datetime();
const NullableLogoUrlSchema = z.url().max(2_048).nullable();
const NonNegativeMoneyMinorSchema = z.number().int().nonnegative();

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
  name: z.string().trim().min(1).max(64),
  shortName: z.string().trim().min(1).max(24),
  logoUrl: NullableLogoUrlSchema,
  defaultGameAccountId: ResourceIdSchema.nullable()
});

export const CreateLeagueTeamRequestSchema = LeagueTeamMutableFieldsSchema.extend({
  ownerUserId: ResourceIdSchema,
  logoUrl: NullableLogoUrlSchema.default(null),
  defaultGameAccountId: ResourceIdSchema.nullable().default(null)
});

export const UpdateLeagueTeamRequestSchema = LeagueTeamMutableFieldsSchema.partial().extend({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  expectedVersion: ExpectedVersionSchema
});

export const LeagueTeamSummarySchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  ownerUserId: ResourceIdSchema,
  ownerPublicUserNo: PublicUserNumberSchema,
  teamNumber: TeamNumberSchema.nullable(),
  name: z.string().min(1),
  shortName: z.string().min(1),
  logoUrl: z.string().nullable(),
  status: LeagueTeamStatusSchema,
  rosterStatus: LeagueTeamRosterStatusSchema,
  activePlayerCount: z.number().int().min(0).max(25),
  salaryTotalMinor: NonNegativeMoneyMinorSchema,
  salaryCapMinor: NonNegativeMoneyMinorSchema,
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
export type LeagueTeamSummary = z.infer<typeof LeagueTeamSummarySchema>;
export type LeagueTeamDetail = z.infer<typeof LeagueTeamDetailSchema>;
export type LeagueTeamListResponse = z.infer<typeof LeagueTeamListResponseSchema>;
