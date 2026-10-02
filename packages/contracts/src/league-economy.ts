import { z } from 'zod';
import { ResourceIdSchema } from './common.js';
import {
  FinanceLedgerDirectionSchema,
  FinanceLedgerEntrySchema,
  FinanceLedgerTypeSchema,
  RosterEntryStatusSchema,
  RosterTransactionTypeSchema
} from './league-roster.js';
import { ValuationMoneyMinorSchema } from './player-valuation.js';

const TimestampSchema = z.iso.datetime();

export const ValuationCompletenessSchema = z.enum(['COMPLETE', 'INCOMPLETE']);

export const TeamAssetPlayerSchema = z.object({
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  cardName: z.string().min(1),
  cardImageUrl: z.string().nullable(),
  position: z.string().nullable(),
  nationality: z.string().nullable(),
  club: z.string().nullable(),
  age: z.number().int().nonnegative().nullable(),
  heightCm: z.number().int().positive().nullable(),
  preferredFoot: z.string().nullable(),
  atRating: z.number().int().nonnegative().nullable(),
  acquiredAt: TimestampSchema,
  salaryMinor: ValuationMoneyMinorSchema,
  rosterStatus: RosterEntryStatusSchema,
  currentValueMinor: ValuationMoneyMinorSchema.nullable(),
  lastEffectiveAt: TimestampSchema.nullable()
});

export const TeamAssetOverviewSchema = z.object({
  leagueId: ResourceIdSchema,
  teamId: ResourceIdSchema,
  teamName: z.string().min(1),
  teamNumber: z.number().int().nonnegative().nullable(),
  teamLogoUrl: z.string().nullable(),
  ownerDisplayName: z.string().min(1),
  ownerPublicUserNo: z.string().regex(/^\d{6}$/),
  shellValueMinor: ValuationMoneyMinorSchema,
  knownPlayerValueMinor: ValuationMoneyMinorSchema,
  totalKnownValueMinor: ValuationMoneyMinorSchema,
  valuationCompleteness: ValuationCompletenessSchema,
  missingValuationCount: z.number().int().nonnegative(),
  activePlayerCount: z.number().int().nonnegative(),
  activeSalaryMinor: ValuationMoneyMinorSchema,
  players: z.array(TeamAssetPlayerSchema)
});

export const PlayerValuationHistoryPointSchema = z.object({
  id: ResourceIdSchema,
  previousValueMinor: ValuationMoneyMinorSchema.nullable(),
  valueMinor: ValuationMoneyMinorSchema,
  effectiveAt: TimestampSchema
});
export const PlayerValuationHistoryResponseSchema = z.object({
  leagueId: ResourceIdSchema,
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  items: z.array(PlayerValuationHistoryPointSchema)
});

export const LeagueTransactionListItemSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  seasonId: ResourceIdSchema,
  type: RosterTransactionTypeSchema,
  playerId: ResourceIdSchema,
  playerName: z.string().min(1),
  sourceLeagueTeamId: ResourceIdSchema.nullable(),
  sourceTeamName: z.string().nullable(),
  targetLeagueTeamId: ResourceIdSchema.nullable(),
  targetTeamName: z.string().nullable(),
  amountMinor: ValuationMoneyMinorSchema.nullable(),
  valuationSnapshotMinor: ValuationMoneyMinorSchema.nullable(),
  transactionFeeMinor: ValuationMoneyMinorSchema.nullable(),
  transactionFeeRuleVersionId: ResourceIdSchema.nullable(),
  reason: z.string().min(1).max(512),
  createdByAdminId: ResourceIdSchema,
  createdAt: TimestampSchema
});

export const LeagueTransactionListResponseSchema = z.object({
  items: z.array(LeagueTransactionListItemSchema),
  nextCursor: z.string().nullable()
});

export const TeamFinanceSummarySchema = z.object({
  leagueId: ResourceIdSchema,
  teamId: ResourceIdSchema,
  seasonId: ResourceIdSchema.nullable(),
  creditTotalMinor: ValuationMoneyMinorSchema,
  debitTotalMinor: ValuationMoneyMinorSchema,
  balanceMinor: z.number().int(),
  uncategorizedEntryCount: z.number().int().nonnegative(),
  entries: z.array(FinanceLedgerEntrySchema)
});

export const CreateManualFinanceEntryRequestSchema = z.object({
  leagueTeamId: ResourceIdSchema,
  seasonId: ResourceIdSchema.nullable(),
  direction: FinanceLedgerDirectionSchema,
  type: FinanceLedgerTypeSchema,
  amountMinor: z.number().int().positive().max(4_294_967_295),
  note: z.string().trim().max(512),
  reason: z.string().trim().min(1).max(512)
});

export const TransactionFeeRuleVersionSchema = z.object({
  id: ResourceIdSchema,
  leagueId: ResourceIdSchema,
  version: z.number().int().positive(),
  rateBps: z.number().int().min(0).max(10_000),
  minimumFeeMinor: ValuationMoneyMinorSchema,
  effectiveAt: TimestampSchema,
  createdByAdminId: ResourceIdSchema,
  createdAt: TimestampSchema
});

export const CreateTransactionFeeRuleRequestSchema = z.object({
  rateBps: z.number().int().min(0).max(10_000),
  minimumFeeMinor: ValuationMoneyMinorSchema,
  effectiveAt: TimestampSchema
});

export type ValuationCompleteness = z.infer<typeof ValuationCompletenessSchema>;
export type TeamAssetOverview = z.infer<typeof TeamAssetOverviewSchema>;
export type PlayerValuationHistoryResponse = z.infer<typeof PlayerValuationHistoryResponseSchema>;
export type LeagueTransactionListItem = z.infer<typeof LeagueTransactionListItemSchema>;
export type LeagueTransactionListResponse = z.infer<typeof LeagueTransactionListResponseSchema>;
export type TeamFinanceSummary = z.infer<typeof TeamFinanceSummarySchema>;
export type CreateManualFinanceEntryRequest = z.infer<typeof CreateManualFinanceEntryRequestSchema>;
export type TransactionFeeRuleVersion = z.infer<typeof TransactionFeeRuleVersionSchema>;
export type CreateTransactionFeeRuleRequest = z.infer<typeof CreateTransactionFeeRuleRequestSchema>;
