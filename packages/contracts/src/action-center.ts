import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

const TimestampSchema = z.iso.datetime();

export const ActionCenterSourceSchema = z.enum(['TRANSACTION', 'FORCED_TRANSFER', 'AUCTION', 'MATCH_RESULT']);
export const ActionCenterSectionSchema = z.enum(['ACTION_REQUIRED', 'STATUS_UPDATE', 'RECENT']);

export const ActionCenterItemSchema = z.object({
  id: z.string().trim().min(1).max(160),
  version: TimestampSchema,
  source: ActionCenterSourceSchema,
  section: ActionCenterSectionSchema,
  league: z.object({
    id: ResourceIdSchema,
    name: z.string().trim().min(1).max(64)
  }),
  seasonId: ResourceIdSchema.nullable(),
  teamId: ResourceIdSchema.nullable(),
  title: z.string().trim().min(1).max(128),
  detail: z.string().trim().min(1).max(256),
  statusLabel: z.string().trim().min(1).max(32),
  occurredAt: TimestampSchema,
  route: z.string().startsWith('/pages/').max(1024)
}).refine((item) => item.source !== 'MATCH_RESULT'
  || /^\/pages\/match-result\/index\?id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.route),
{ path: ['route'], message: 'Match result reminder requires an internal match route' });

export const ActionCenterResponseSchema = z.object({
  items: z.array(ActionCenterItemSchema).max(200),
  actionRequiredCount: z.number().int().nonnegative()
});

export type ActionCenterSource = z.infer<typeof ActionCenterSourceSchema>;
export type ActionCenterSection = z.infer<typeof ActionCenterSectionSchema>;
export type ActionCenterItem = z.infer<typeof ActionCenterItemSchema>;
export type ActionCenterResponse = z.infer<typeof ActionCenterResponseSchema>;
