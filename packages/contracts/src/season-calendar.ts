import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

export const SeasonAgendaMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const SeasonAgendaKindSchema = z.enum(['FIXTURE', 'TRANSFER', 'VALUATION', 'NOMINATION']);
export const SeasonAgendaStatusSchema = z.enum(['UPCOMING', 'ACTIVE', 'ENDED']);
export const SeasonAgendaItemSchema = z.object({
  id: ResourceIdSchema,
  kind: SeasonAgendaKindSchema,
  title: z.string().min(1),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: SeasonAgendaStatusSchema,
  targetPath: z.string().startsWith('/pages/').nullable()
});
export const SeasonAgendaResponseSchema = z.object({
  month: SeasonAgendaMonthSchema,
  items: z.array(SeasonAgendaItemSchema)
});

export type SeasonAgendaItem = z.infer<typeof SeasonAgendaItemSchema>;
export type SeasonAgendaResponse = z.infer<typeof SeasonAgendaResponseSchema>;
