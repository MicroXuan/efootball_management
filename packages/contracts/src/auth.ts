import { z } from 'zod';

export const WechatLoginRequestSchema = z.object({
  code: z.string().trim().min(1).max(128)
});

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(32).max(512)
});

export const LogoutRequestSchema = RefreshRequestSchema;

export const AuthTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
  refreshToken: z.string().min(32),
  refreshExpiresInSeconds: z.number().int().positive()
});

export type WechatLoginRequest = z.infer<typeof WechatLoginRequestSchema>;
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;
