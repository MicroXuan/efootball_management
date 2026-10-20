import { z } from 'zod';
import { ExpectedVersionSchema, ResourceIdSchema } from './common.js';

export const DisappearanceRequestStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'INVALIDATED']);
export const SubmitDisappearanceRequestSchema = z.object({
  seasonId: ResourceIdSchema,
  reason: z.string().trim().min(1).max(512),
  expectedOwnershipVersion: ExpectedVersionSchema
});
export const DisappearanceRequestSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  ownershipId: ResourceIdSchema,
  requesterTeamId: ResourceIdSchema,
  playerName: z.string().min(1),
  status: DisappearanceRequestStatusSchema,
  reason: z.string().min(1),
  reviewReason: z.string().nullable(),
  version: ExpectedVersionSchema,
  createdAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable()
});
export const DisappearanceRequestListSchema = z.object({ items: z.array(DisappearanceRequestSchema) });
export type SubmitDisappearanceRequest = z.infer<typeof SubmitDisappearanceRequestSchema>;
export type DisappearanceRequest = z.infer<typeof DisappearanceRequestSchema>;
