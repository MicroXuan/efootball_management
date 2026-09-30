import { z } from 'zod';

const SourceIdentifierSchema = z.union([z.string().min(1), z.number().finite()]);

export const PesdataPlayerSummarySchema = z.object({
  playerId: SourceIdentifierSchema,
  playerName: z.string().nullish(),
  playerName_cn: z.string().nullish(),
  playerName_ja: z.string().nullish(),
  player_chinese_name: z.string().nullish(),
  position: z.string().nullish(),
  overall: z.union([z.string(), z.number()]).nullish(),
  cardType: z.union([z.string(), z.number()]).nullish(),
  agentTitle: z.string().nullish(),
  agentDate: z.string().nullish()
}).passthrough();

export const PesdataPlayerDetailSchema = PesdataPlayerSummarySchema.extend({
  base_pes_id: SourceIdentifierSchema.nullish(),
  skillList: z.unknown().optional(),
  Skills: z.unknown().optional(),
  PositionHot: z.unknown().optional(),
  autoBuildAllocation: z.record(z.string(), z.coerce.number().int().nonnegative()).nullish(),
  autoBuildMaxOverall: z.coerce.number().int().nullish(),
  dtRating: z.coerce.number().int().nullish(),
  algorithmVersion: z.string().nullish(),
  created_at: z.union([z.string(), z.number(), z.date()]).nullish()
}).passthrough();

export const PesdataListEnvelopeSchema = z.object({
  code: z.literal(1),
  data: z.object({
    list: z.array(PesdataPlayerSummarySchema),
    count: z.coerce.number().int().nonnegative()
  }).passthrough()
}).passthrough();

export const PesdataDetailEnvelopeSchema = z.object({
  code: z.literal(1),
  data: z.array(PesdataPlayerDetailSchema)
}).passthrough();

export type PesdataPlayerSummary = z.infer<typeof PesdataPlayerSummarySchema>;
export type PesdataPlayerDetail = z.infer<typeof PesdataPlayerDetailSchema>;
