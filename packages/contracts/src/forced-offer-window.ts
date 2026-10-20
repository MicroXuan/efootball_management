import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { ExpectedVersionSchema } from './competition.js';

const TimestampSchema = z.iso.datetime();

const ForcedOfferWindowFieldsSchema = z.object({
  name: z.string().trim().min(1).max(64),
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
}).superRefine((window, context) => {
  if (Date.parse(window.startsAt) >= Date.parse(window.endsAt)) {
    context.addIssue({ code: 'custom', path: ['endsAt'], message: 'endsAt must be after startsAt' });
  }
});

export const ForcedOfferWindowStatusSchema = z.enum(['UPCOMING', 'OPEN', 'CLOSED']);
export const CreateForcedOfferWindowRequestSchema = ForcedOfferWindowFieldsSchema;
export const UpdateForcedOfferWindowRequestSchema = ForcedOfferWindowFieldsSchema.and(z.object({
  expectedVersion: ExpectedVersionSchema,
}));
export const ForcedOfferWindowSchema = ForcedOfferWindowFieldsSchema.and(z.object({
  id: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  createdByAdminId: ResourceIdSchema,
  status: ForcedOfferWindowStatusSchema,
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}));
export const ForcedOfferWindowListResponseSchema = z.object({ items: z.array(ForcedOfferWindowSchema) });

export type ForcedOfferWindowStatus = z.infer<typeof ForcedOfferWindowStatusSchema>;
export type CreateForcedOfferWindowRequest = z.infer<typeof CreateForcedOfferWindowRequestSchema>;
export type UpdateForcedOfferWindowRequest = z.infer<typeof UpdateForcedOfferWindowRequestSchema>;
export type ForcedOfferWindow = z.infer<typeof ForcedOfferWindowSchema>;
export type ForcedOfferWindowListResponse = z.infer<typeof ForcedOfferWindowListResponseSchema>;
