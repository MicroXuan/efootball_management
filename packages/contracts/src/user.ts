import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(32),
  avatarUrl: z.url().max(2048).nullable(),
  region: z.string().trim().max(64).nullable()
});

export const CurrentUserSchema = z.object({
  id: ResourceIdSchema,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  region: z.string().nullable(),
  status: z.literal('ACTIVE'),
  profileComplete: z.boolean()
});

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;
export type CurrentUserResponse = z.infer<typeof CurrentUserSchema>;

