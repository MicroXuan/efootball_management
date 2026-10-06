import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { ExpectedVersionSchema } from './competition.js';

const TimestampSchema = z.iso.datetime();

export const AdminStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export const AdminRoleSchema = z.enum(['PLATFORM_ADMIN', 'LEAGUE_MANAGER']);

export const AdminAccountSummarySchema = z.object({
  id: ResourceIdSchema,
  username: z.string().min(1),
  displayName: z.string().min(1),
  status: AdminStatusSchema,
  failedLoginCount: z.number().int().nonnegative(),
  lockedUntil: TimestampSchema.nullable(),
  lastLoginAt: TimestampSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const AdminLeagueGrantSchema = z.object({
  id: ResourceIdSchema,
  adminId: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  leagueName: z.string().min(1),
  role: z.literal('LEAGUE_MANAGER'),
  grantedById: ResourceIdSchema,
  createdAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable(),
  version: z.number().int().positive()
});

export const CreateAdminAccountRequestSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(128)
});

export const UpdateAdminAccountRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  status: AdminStatusSchema.optional(),
  expectedVersion: ExpectedVersionSchema
});

export const ResetAdminPasswordRequestSchema = z.object({
  password: z.string().min(8).max(128),
  expectedVersion: ExpectedVersionSchema
});

export const CreateAdminLeagueGrantRequestSchema = z.object({
  leagueId: ResourceIdSchema,
  role: z.literal('LEAGUE_MANAGER')
});

const AuditResourceIdSchema = z.string().trim().min(1).max(36);

export const AuditLogSchema = z.object({
  id: ResourceIdSchema,
  actorAdminId: ResourceIdSchema.nullable(),
  actorUserId: ResourceIdSchema.nullable().default(null),
  actorDisplayName: z.string().min(1).nullable().default(null),
  leagueId: ResourceIdSchema.nullable(),
  leagueName: z.string().min(1).nullable().default(null),
  action: z.string().min(1).max(128),
  resourceType: z.string().min(1).max(64),
  resourceId: AuditResourceIdSchema.nullable(),
  subjectDisplayName: z.string().min(1).nullable().default(null),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: TimestampSchema
});

export type AdminStatus = z.infer<typeof AdminStatusSchema>;
export type AdminRole = z.infer<typeof AdminRoleSchema>;
export type AdminAccountSummary = z.infer<typeof AdminAccountSummarySchema>;
export type AdminLeagueGrant = z.infer<typeof AdminLeagueGrantSchema>;
export type CreateAdminAccountRequest = z.infer<typeof CreateAdminAccountRequestSchema>;
export type UpdateAdminAccountRequest = z.infer<typeof UpdateAdminAccountRequestSchema>;
export type ResetAdminPasswordRequest = z.infer<typeof ResetAdminPasswordRequestSchema>;
export type CreateAdminLeagueGrantRequest = z.infer<typeof CreateAdminLeagueGrantRequestSchema>;
export type AuditLog = z.infer<typeof AuditLogSchema>;
