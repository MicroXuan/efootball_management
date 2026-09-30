import { z } from 'zod';
import { AdminAccountSummarySchema } from './admin.js';

export const AdminLoginRequestSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(128)
});

export const AdminRefreshRequestSchema = z.object({
  refreshToken: z.string().min(32).max(512)
});

export const AdminLogoutRequestSchema = AdminRefreshRequestSchema;

export const AdminAuthResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
  refreshToken: z.string().min(32).max(512),
  refreshExpiresInSeconds: z.number().int().positive(),
  admin: AdminAccountSummarySchema
});

export const AdminMeResponseSchema = z.object({
  admin: AdminAccountSummarySchema,
  platformAdmin: z.boolean(),
  leagueGrants: z.array(z.object({
    leagueId: z.uuid(),
    leagueName: z.string().min(1),
    role: z.literal('LEAGUE_MANAGER')
  }))
});

export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;
export type AdminRefreshRequest = z.infer<typeof AdminRefreshRequestSchema>;
export type AdminLogoutRequest = z.infer<typeof AdminLogoutRequestSchema>;
export type AdminAuthResponse = z.infer<typeof AdminAuthResponseSchema>;
export type AdminMeResponse = z.infer<typeof AdminMeResponseSchema>;
