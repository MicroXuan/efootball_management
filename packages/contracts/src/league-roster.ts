import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import { ExpectedVersionSchema, IdempotencyKeySchema } from './competition.js';

const TimestampSchema = z.iso.datetime();
const MAX_UNSIGNED_INT = 4_294_967_295;
const NonNegativeMoneyMinorSchema = z.number().int().nonnegative().max(MAX_UNSIGNED_INT);
const NullablePositiveMoneyMinorSchema = z.number().int().positive().max(MAX_UNSIGNED_INT).nullable();

export const MoneyMinorSchema = z.number().int().positive().max(MAX_UNSIGNED_INT);
export const DtRatingSchema = z.number().int().min(0).max(120);
export const SalaryRuleStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'RETIRED']);

export const SalaryTierSchema = z.object({
  minDtRating: DtRatingSchema,
  maxDtRating: DtRatingSchema,
  salaryMinor: MoneyMinorSchema
}).superRefine((tier, context) => {
  if (tier.minDtRating > tier.maxDtRating) {
    context.addIssue({
      code: 'custom',
      path: ['maxDtRating'],
      message: 'maxDtRating must be at or above minDtRating'
    });
  }
});

export const SalaryTierListSchema = z.array(SalaryTierSchema).min(1).superRefine((tiers, context) => {
  let expectedMinimum = 0;

  for (const [index, tier] of tiers.entries()) {
    if (tier.minDtRating !== expectedMinimum) {
      context.addIssue({
        code: 'custom',
        path: [index, 'minDtRating'],
        message: `minDtRating must be ${expectedMinimum} to avoid gaps or overlaps`
      });
    }
    expectedMinimum = tier.maxDtRating + 1;
  }

  if (expectedMinimum !== 121) {
    context.addIssue({
      code: 'custom',
      path: [tiers.length - 1, 'maxDtRating'],
      message: 'salary tiers must cover DT ratings through 120'
    });
  }
});

export const SalaryRuleVersionSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  version: z.number().int().positive(),
  salaryCapMinor: MoneyMinorSchema,
  tiers: SalaryTierListSchema,
  status: SalaryRuleStatusSchema,
  effectiveAt: TimestampSchema,
  createdByAdminId: ResourceIdSchema,
  createdAt: TimestampSchema
});

export const CreateSalaryRuleVersionRequestSchema = z.object({
  salaryCapMinor: MoneyMinorSchema,
  tiers: SalaryTierListSchema,
  effectiveAt: TimestampSchema,
  expectedCurrentVersion: z.number().int().nonnegative()
});
export const PreviewSalaryRuleRequestSchema = CreateSalaryRuleVersionRequestSchema.pick({
  salaryCapMinor: true,
  tiers: true
});

export const TransferOperationSchema = z.enum(['BUY', 'SELL', 'TRANSFER', 'CARD_UPGRADE']);

const TransferWindowFieldsSchema = z.object({
  name: z.string().trim().min(1).max(64),
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  allowBuy: z.boolean(),
  allowSell: z.boolean(),
  allowTransfer: z.boolean(),
  allowCardUpgrade: z.boolean()
}).superRefine((window, context) => {
  if (Date.parse(window.startsAt) >= Date.parse(window.endsAt)) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'endsAt must be after startsAt'
    });
  }
  if (!window.allowBuy && !window.allowSell && !window.allowTransfer && !window.allowCardUpgrade) {
    context.addIssue({
      code: 'custom',
      path: ['allowBuy'],
      message: 'at least one transfer operation must be enabled'
    });
  }
});

export const CreateTransferWindowRequestSchema = TransferWindowFieldsSchema;
export const UpdateTransferWindowRequestSchema = TransferWindowFieldsSchema.and(z.object({
  expectedVersion: ExpectedVersionSchema
}));
export const TransferWindowSchema = TransferWindowFieldsSchema.and(z.object({
  id: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  createdByAdminId: ResourceIdSchema,
  version: z.number().int().positive(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
}));

export const RosterEntryStatusSchema = z.enum(['ACTIVE', 'RELEASED', 'TRANSFERRED']);
export const RosterEntrySchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  leagueTeamId: ResourceIdSchema,
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  currentPlayerCardId: ResourceIdSchema,
  cardName: z.string().min(1),
  maxOverall: z.number().int().min(1).max(120),
  dtRating: DtRatingSchema,
  salaryRuleVersionId: ResourceIdSchema,
  salaryMinor: MoneyMinorSchema,
  acquiredAt: TimestampSchema,
  status: RosterEntryStatusSchema,
  version: z.number().int().positive()
});

export const RosterTransactionTypeSchema = z.enum([
  'BUY',
  'SELL',
  'RELEASE',
  'TRANSFER',
  'CARD_UPGRADE',
  'SALARY_RECALCULATION',
  'EMERGENCY_CORRECTION'
]);
export const RosterTransactionSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  type: RosterTransactionTypeSchema,
  playerId: ResourceIdSchema,
  sourceLeagueTeamId: ResourceIdSchema.nullable(),
  targetLeagueTeamId: ResourceIdSchema.nullable(),
  oldPlayerCardId: ResourceIdSchema.nullable(),
  newPlayerCardId: ResourceIdSchema.nullable(),
  oldSalaryMinor: NonNegativeMoneyMinorSchema.nullable(),
  newSalaryMinor: NonNegativeMoneyMinorSchema.nullable(),
  amountMinor: NullablePositiveMoneyMinorSchema,
  reason: z.string().min(1).max(512),
  createdByAdminId: ResourceIdSchema,
  createdAt: TimestampSchema
});

export const FinanceLedgerDirectionSchema = z.enum(['DEBIT', 'CREDIT']);
export const FinanceLedgerTypeSchema = z.enum([
  'PLAYER_PURCHASE',
  'PLAYER_SALE',
  'PLAYER_TRANSFER',
  'CARD_UPGRADE',
  'MANUAL_ADJUSTMENT'
]);
export const FinanceLedgerEntrySchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  leagueTeamId: ResourceIdSchema,
  rosterTransactionId: ResourceIdSchema.nullable(),
  direction: FinanceLedgerDirectionSchema,
  type: FinanceLedgerTypeSchema,
  amountMinor: MoneyMinorSchema,
  note: z.string().max(512),
  createdAt: TimestampSchema
});

const RosterMutationBaseSchema = z.object({
  seasonId: ResourceIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  reason: z.string().trim().min(1).max(512)
});

export const AcquirePlayerRequestSchema = RosterMutationBaseSchema.extend({
  targetLeagueTeamId: ResourceIdSchema,
  playerCardId: ResourceIdSchema,
  amountMinor: MoneyMinorSchema
});
export const ReleasePlayerRequestSchema = RosterMutationBaseSchema.extend({
  ownershipId: ResourceIdSchema,
  amountMinor: MoneyMinorSchema.nullable().default(null),
  expectedVersion: ExpectedVersionSchema
});
export const TransferPlayerRequestSchema = RosterMutationBaseSchema.extend({
  ownershipId: ResourceIdSchema,
  targetLeagueTeamId: ResourceIdSchema,
  amountMinor: MoneyMinorSchema.nullable().default(null),
  expectedVersion: ExpectedVersionSchema
});
export const UpgradePlayerCardRequestSchema = RosterMutationBaseSchema.extend({
  ownershipId: ResourceIdSchema,
  newPlayerCardId: ResourceIdSchema,
  amountMinor: MoneyMinorSchema.nullable().default(null),
  expectedVersion: ExpectedVersionSchema
});

export type SalaryRuleVersion = z.infer<typeof SalaryRuleVersionSchema>;
export type CreateSalaryRuleVersionRequest = z.infer<typeof CreateSalaryRuleVersionRequestSchema>;
export type PreviewSalaryRuleRequest = z.infer<typeof PreviewSalaryRuleRequestSchema>;
export type CreateTransferWindowRequest = z.infer<typeof CreateTransferWindowRequestSchema>;
export type UpdateTransferWindowRequest = z.infer<typeof UpdateTransferWindowRequestSchema>;
export type TransferOperation = z.infer<typeof TransferOperationSchema>;
export type TransferWindow = z.infer<typeof TransferWindowSchema>;
export type RosterEntry = z.infer<typeof RosterEntrySchema>;
export type RosterTransaction = z.infer<typeof RosterTransactionSchema>;
export type FinanceLedgerEntry = z.infer<typeof FinanceLedgerEntrySchema>;
export type AcquirePlayerRequest = z.infer<typeof AcquirePlayerRequestSchema>;
export type ReleasePlayerRequest = z.infer<typeof ReleasePlayerRequestSchema>;
export type TransferPlayerRequest = z.infer<typeof TransferPlayerRequestSchema>;
export type UpgradePlayerCardRequest = z.infer<typeof UpgradePlayerCardRequestSchema>;
