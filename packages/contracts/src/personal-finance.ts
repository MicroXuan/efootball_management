import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { FinanceLedgerDirectionSchema } from './league-roster.js';

export const PersonalFinanceEntryInputSchema = z.object({
  seasonId: ResourceIdSchema,
  direction: FinanceLedgerDirectionSchema,
  amountMinor: z.number().int().positive().max(4_294_967_295),
  title: z.string().trim().min(1).max(80),
  note: z.string().trim().max(300).default(''),
  occurredOn: z.iso.date(),
});

export const PersonalFinanceEntrySchema = PersonalFinanceEntryInputSchema.extend({
  id: ResourceIdSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PersonalFinanceUpdateSchema = PersonalFinanceEntryInputSchema.extend({
  expectedVersion: z.number().int().positive(),
});

export const PersonalFinanceListSchema = z.object({
  leagueId: ResourceIdSchema,
  teamId: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  creditTotalMinor: z.number().int().nonnegative(),
  debitTotalMinor: z.number().int().nonnegative(),
  balanceMinor: z.number().int(),
  items: z.array(PersonalFinanceEntrySchema),
});

export type PersonalFinanceEntryInput = z.input<typeof PersonalFinanceEntryInputSchema>;
export type PersonalFinanceUpdate = z.input<typeof PersonalFinanceUpdateSchema>;
export type PersonalFinanceEntry = z.output<typeof PersonalFinanceEntrySchema>;
export type PersonalFinanceList = z.output<typeof PersonalFinanceListSchema>;
