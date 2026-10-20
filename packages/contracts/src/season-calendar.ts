import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

export const SeasonAgendaMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const SeasonCalendarDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const SeasonAgendaKindSchema = z.enum(['TRANSFER', 'FORCED_OFFER', 'VALUATION', 'NOMINATION', 'MANUAL']);
export const SeasonCalendarNoteKindSchema = z.enum(['HOLIDAY', 'MAINTENANCE', 'NOTICE']);
export const SeasonAgendaStatusSchema = z.enum(['UPCOMING', 'ACTIVE', 'ENDED']);

const AgendaItemBase = z.object({
  id: ResourceIdSchema,
  title: z.string().min(1),
  description: z.string().nullable(),
  firstDate: SeasonCalendarDateSchema,
  lastDate: SeasonCalendarDateSchema,
  status: SeasonAgendaStatusSchema,
  targetPath: z.string().startsWith('/pages/').nullable()
});
export const SeasonAgendaItemSchema = z.discriminatedUnion('kind', [
  AgendaItemBase.extend({ kind: z.enum(['TRANSFER', 'FORCED_OFFER', 'VALUATION', 'NOMINATION']),
    noteKind: z.null(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }),
  AgendaItemBase.extend({ kind: z.literal('MANUAL'), noteKind: SeasonCalendarNoteKindSchema,
    startsAt: z.null(), endsAt: z.null() })
]);
export const SeasonAgendaResponseSchema = z.object({
  month: SeasonAgendaMonthSchema,
  seasonId: ResourceIdSchema.nullable(),
  timezone: z.literal('Asia/Shanghai'),
  items: z.array(SeasonAgendaItemSchema)
});

const NoteFields = z.object({
  kind: SeasonCalendarNoteKindSchema,
  title: z.string().trim().min(1).max(64),
  description: z.string().trim().max(300).nullable().optional(),
  startsOn: SeasonCalendarDateSchema,
  endsOn: SeasonCalendarDateSchema
}).refine((value) => value.endsOn >= value.startsOn, { path: ['endsOn'], message: 'End date must not precede start date' });
export const CreateSeasonCalendarNoteRequestSchema = NoteFields;
export const UpdateSeasonCalendarNoteRequestSchema = z.object({
  kind: SeasonCalendarNoteKindSchema,
  title: z.string().trim().min(1).max(64),
  description: z.string().trim().max(300).nullable().optional(),
  startsOn: SeasonCalendarDateSchema,
  endsOn: SeasonCalendarDateSchema,
  expectedVersion: z.number().int().positive()
}).refine((value) => value.endsOn >= value.startsOn, { path: ['endsOn'], message: 'End date must not precede start date' });
export const SeasonCalendarNoteSchema = z.object({
  id: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  kind: SeasonCalendarNoteKindSchema,
  title: z.string().min(1).max(64),
  description: z.string().max(300).nullable(),
  startsOn: SeasonCalendarDateSchema,
  endsOn: SeasonCalendarDateSchema,
  createdByAdminId: ResourceIdSchema,
  updatedByAdminId: ResourceIdSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable()
});

export type SeasonAgendaItem = z.infer<typeof SeasonAgendaItemSchema>;
export type SeasonAgendaResponse = z.infer<typeof SeasonAgendaResponseSchema>;
export type SeasonCalendarNote = z.infer<typeof SeasonCalendarNoteSchema>;
export type CreateSeasonCalendarNoteRequest = z.infer<typeof CreateSeasonCalendarNoteRequestSchema>;
export type UpdateSeasonCalendarNoteRequest = z.infer<typeof UpdateSeasonCalendarNoteRequestSchema>;
