import { z } from 'zod';
import { ExpectedVersionSchema, ResourceIdSchema } from './common.js';

export const NominationWindowSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  perTeamLimit: z.number().int().positive(),
  version: ExpectedVersionSchema
});
export const NominationWindowListResponseSchema = z.object({ items: z.array(NominationWindowSchema) });
export const CreateNominationWindowRequestSchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  perTeamLimit: z.number().int().min(1).max(65535)
}).refine((value) => value.startsAt < value.endsAt, { message: '结束时间必须晚于开始时间', path: ['endsAt'] });
export const UpdateNominationWindowRequestSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
  perTeamLimit: z.number().int().min(1).max(65535).optional()
});
export type NominationWindow = z.infer<typeof NominationWindowSchema>;
export type CreateNominationWindowRequest = z.infer<typeof CreateNominationWindowRequestSchema>;
export type UpdateNominationWindowRequest = z.infer<typeof UpdateNominationWindowRequestSchema>;
