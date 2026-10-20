import { z } from 'zod';
import { ExpectedVersionSchema, ResourceIdSchema } from './common.js';
import { MoneyMinorSchema } from './league-roster.js';

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
export const ReviewDisappearanceRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(1).max(512),
  expectedVersion: ExpectedVersionSchema
});
export const AdminDisappearanceRequestSchema = DisappearanceRequestSchema.extend({
  requesterTeamName: z.string().min(1),
  requesterTeamNumber: z.number().int().nullable(),
  events: z.array(z.object({ id: ResourceIdSchema, fromStatus: DisappearanceRequestStatusSchema.nullable(), toStatus: DisappearanceRequestStatusSchema, reason: z.string().nullable(), createdAt: z.iso.datetime() }))
});
export const AdminDisappearanceRequestListSchema = z.object({ items: z.array(AdminDisappearanceRequestSchema) });
export type SubmitDisappearanceRequest = z.infer<typeof SubmitDisappearanceRequestSchema>;
export type DisappearanceRequest = z.infer<typeof DisappearanceRequestSchema>;
export type ReviewDisappearanceRequest = z.infer<typeof ReviewDisappearanceRequestSchema>;

export const TransferProposalStatusSchema = z.enum(['PENDING_COUNTERPARTY', 'PENDING_ADMIN', 'REJECTED', 'WITHDRAWN', 'APPROVED', 'EXPIRED', 'INVALIDATED']);
export const SubmitTransferProposalSchema = z.object({
  seasonId: ResourceIdSchema,
  initiatorTeamId: ResourceIdSchema,
  ownershipId: ResourceIdSchema,
  targetTeamId: ResourceIdSchema,
  amountMinor: MoneyMinorSchema,
  expectedOwnershipVersion: ExpectedVersionSchema,
  reason: z.string().trim().max(512).optional()
});
export const RespondTransferProposalSchema = z.object({
  decision: z.enum(['CONFIRM', 'REJECT', 'WITHDRAW']),
  expectedVersion: ExpectedVersionSchema,
  reason: z.string().trim().max(512).optional()
});
export const TransferCandidateSchema = z.object({
  ownershipId: ResourceIdSchema,
  ownershipVersion: ExpectedVersionSchema,
  sourceTeamId: ResourceIdSchema,
  sourceTeamNumber: z.number().int().nullable(),
  sourceTeamName: z.string(),
  eligible: z.boolean(),
  reason: z.string().nullable()
});
export const TransferProposalSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  ownershipId: ResourceIdSchema,
  playerName: z.string(),
  sourceTeamId: ResourceIdSchema,
  sourceTeamName: z.string(),
  sourceTeamNumber: z.number().int().nullable(),
  targetTeamId: ResourceIdSchema,
  targetTeamName: z.string(),
  targetTeamNumber: z.number().int().nullable(),
  initiatorTeamId: ResourceIdSchema,
  amountMinor: MoneyMinorSchema,
  status: TransferProposalStatusSchema,
  reason: z.string().nullable(),
  reviewReason: z.string().nullable(),
  version: ExpectedVersionSchema,
  createdAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable()
});
export const TransferProposalListSchema = z.object({ items: z.array(TransferProposalSchema) });
export const ReviewTransferProposalSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(1).max(512),
  expectedVersion: ExpectedVersionSchema
});
export const AdminTransferProposalSchema = TransferProposalSchema.extend({
  counterpartyConfirmed: z.boolean(),
  events: z.array(z.object({ id: ResourceIdSchema, fromStatus: TransferProposalStatusSchema.nullable(), toStatus: TransferProposalStatusSchema,
    reason: z.string().nullable(), createdAt: z.iso.datetime() }))
});
export const AdminTransferProposalListSchema = z.object({ items: z.array(AdminTransferProposalSchema) });
export type SubmitTransferProposal = z.infer<typeof SubmitTransferProposalSchema>;
export type RespondTransferProposal = z.infer<typeof RespondTransferProposalSchema>;
export type TransferProposal = z.infer<typeof TransferProposalSchema>;
export type ReviewTransferProposal = z.infer<typeof ReviewTransferProposalSchema>;
