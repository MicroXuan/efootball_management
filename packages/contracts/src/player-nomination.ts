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

export const SubmitNominationRequestSchema = z.object({ playerId: ResourceIdSchema });
export const PlayerNominationSchema = z.object({
  id: ResourceIdSchema,
  windowId: ResourceIdSchema,
  leagueTeamId: ResourceIdSchema,
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  createdAt: z.iso.datetime(),
  withdrawnAt: z.iso.datetime().nullable()
});
export const MyNominationWorkspaceSchema = z.object({
  window: NominationWindowSchema,
  leagueTeamId: ResourceIdSchema,
  isOpen: z.boolean(),
  remainingSlots: z.number().int().min(0),
  nominations: z.array(PlayerNominationSchema)
});
export const NominationCandidateSchema = z.object({
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  nominatorCount: z.number().int().positive(),
  nominators: z.array(z.object({ leagueTeamId: ResourceIdSchema, teamNumber: z.number().int().nullable(), teamName: z.string(), ownerAlias: z.string() })),
  eligible: z.boolean()
});
export const NominationCandidateListSchema = z.object({ items: z.array(NominationCandidateSchema) });
export type SubmitNominationRequest = z.infer<typeof SubmitNominationRequestSchema>;
export type PlayerNomination = z.infer<typeof PlayerNominationSchema>;
export type MyNominationWorkspace = z.infer<typeof MyNominationWorkspaceSchema>;
export type NominationCandidate = z.infer<typeof NominationCandidateSchema>;
