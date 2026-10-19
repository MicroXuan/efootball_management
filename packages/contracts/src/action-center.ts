import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

const TimestampSchema = z.iso.datetime();

export const ActionCenterSourceSchema = z.enum(['TRANSACTION', 'FORCED_TRANSFER', 'AUCTION']);
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
});

export const ActionCenterResponseSchema = z.object({
  // Current actions are uncapped; each recent-history source is capped by the API.
  // A total cap would reject valid aggregates and hide actionable reminders.
  items: z.array(ActionCenterItemSchema),
  actionRequiredCount: z.number().int().nonnegative()
});

export type ActionCenterSource = z.infer<typeof ActionCenterSourceSchema>;
export type ActionCenterSection = z.infer<typeof ActionCenterSectionSchema>;
export type ActionCenterItem = z.infer<typeof ActionCenterItemSchema>;
export type ActionCenterResponse = z.infer<typeof ActionCenterResponseSchema>;
