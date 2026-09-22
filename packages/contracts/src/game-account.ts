import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

export const GamePlatformSchema = z.enum([
  'MOBILE',
  'PLAYSTATION',
  'XBOX',
  'STEAM'
]);

export const GameAccountInputSchema = z.object({
  platform: GamePlatformSchema,
  serverRegion: z.string().trim().min(1).max(32),
  gamerTag: z.string().trim().min(1).max(64),
  gameUid: z.string().trim().min(1).max(64).nullable().optional(),
  isDefault: z.boolean().default(false)
});

export const GameAccountSchema = GameAccountInputSchema.extend({
  id: ResourceIdSchema,
  gameUid: z.string().nullable(),
  verificationStatus: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type GamePlatform = z.infer<typeof GamePlatformSchema>;
export type GameAccountInput = z.input<typeof GameAccountInputSchema>;
export type ParsedGameAccountInput = z.output<typeof GameAccountInputSchema>;
export type GameAccountResponse = z.infer<typeof GameAccountSchema>;

