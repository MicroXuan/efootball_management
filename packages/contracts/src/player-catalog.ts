import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

export const PlayerPositionSchema = z.enum([
  'GK',
  'CB',
  'LB',
  'RB',
  'DMF',
  'CMF',
  'LMF',
  'RMF',
  'AMF',
  'LWF',
  'RWF',
  'SS',
  'CF'
]);

export const PlayerCardTypeSchema = z.enum([
  'STANDARD',
  'LEGENDARY',
  'EPIC',
  'BIG_TIME',
  'TRENDING',
  'FEATURED',
  'HIGHLIGHT',
  'SHOW_TIME',
  'OTHER'
]);

export const PlayerCardStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const PlayerAttributesSchema = z.record(z.string(), z.json());

export const PlayerSearchQuerySchema = z.object({
  keyword: z.string().trim().min(1).max(80).optional(),
  position: PlayerPositionSchema.optional(),
  minOverall: z.coerce.number().int().min(1).max(110).optional(),
  maxOverall: z.coerce.number().int().min(1).max(110).optional(),
  cardType: PlayerCardTypeSchema.optional(),
  cardPackId: ResourceIdSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).refine(
  (value) => !value.minOverall || !value.maxOverall || value.minOverall <= value.maxOverall,
  { message: 'minOverall must not exceed maxOverall', path: ['minOverall'] }
);

export const CardPackSummarySchema = z.object({
  id: ResourceIdSchema,
  nameZh: z.string().nullable(),
  nameEn: z.string().nullable(),
  season: z.string().nullable(),
  releaseDate: z.iso.date().nullable(),
  coverUrl: z.string().nullable()
});

export const PlayerCardSummarySchema = z.object({
  id: ResourceIdSchema,
  playerId: ResourceIdSchema,
  playerNameZh: z.string().nullable(),
  playerNameEn: z.string().nullable(),
  cardName: z.string(),
  position: PlayerPositionSchema,
  overallRating: z.number().int().min(1).max(110),
  cardType: PlayerCardTypeSchema,
  playStyle: z.string().nullable(),
  imageUrl: z.string().nullable(),
  pack: CardPackSummarySchema.nullable(),
  publishedAt: z.iso.datetime()
});

export const PlayerSearchResponseSchema = z.object({
  items: z.array(PlayerCardSummarySchema),
  nextCursor: z.string().nullable(),
  releaseSequence: z.number().int().positive()
});

export const SkillSummarySchema = z.object({
  code: z.string(),
  nameZh: z.string().nullable(),
  nameEn: z.string().nullable()
});

export const PlayerDetailSchema = z.object({
  id: ResourceIdSchema,
  nameZh: z.string().nullable(),
  nameEn: z.string().nullable(),
  shortName: z.string().nullable(),
  nationality: z.string().nullable(),
  club: z.string().nullable(),
  cards: z.array(PlayerCardSummarySchema)
});

export const PlayerAutoBuildSchema = z.object({
  allocation: z.record(z.string(), z.number().int().nonnegative()),
  maxOverall: z.number().int().min(1).max(110),
  dtRating: z.number().int().min(1).max(120).nullable(),
  algorithmVersion: z.string().min(1).max(64)
});

export const PlayerCardDetailSchema = PlayerCardSummarySchema.extend({
  nationality: z.string().nullable(),
  club: z.string().nullable(),
  status: PlayerCardStatusSchema,
  skills: z.array(SkillSummarySchema),
  attributes: PlayerAttributesSchema,
  otherCards: z.array(PlayerCardSummarySchema),
  autoBuild: PlayerAutoBuildSchema.nullable()
});

export const CardPackListResponseSchema = z.object({
  items: z.array(CardPackSummarySchema.extend({ cardCount: z.number().int().nonnegative() })),
  nextCursor: z.string().nullable(),
  releaseSequence: z.number().int().positive()
});

export const CardPackDetailSchema = CardPackSummarySchema.extend({
  cards: z.array(PlayerCardSummarySchema)
});

export const CreatePlayerFavoriteRequestSchema = z.object({
  playerId: ResourceIdSchema
});

export const PlayerFavoriteListQuerySchema = z.object({
  keyword: z.string().trim().min(1).max(80).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const PlayerFavoriteStatusQuerySchema = z.object({
  playerIds: z.string().trim().min(1)
    .transform((value) => [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))])
    .pipe(z.array(ResourceIdSchema).min(1).max(100))
});

export const PlayerFavoriteItemSchema = z.object({
  playerId: ResourceIdSchema,
  favoritedAt: z.iso.datetime(),
  card: PlayerCardSummarySchema
});

export const PlayerFavoriteListResponseSchema = z.object({
  items: z.array(PlayerFavoriteItemSchema),
  nextCursor: z.string().nullable()
});

export const PlayerFavoriteStatusResponseSchema = z.object({
  favoritePlayerIds: z.array(ResourceIdSchema)
});

export type PlayerPosition = z.infer<typeof PlayerPositionSchema>;
export type PlayerCardType = z.infer<typeof PlayerCardTypeSchema>;
export type PlayerCardStatus = z.infer<typeof PlayerCardStatusSchema>;
export type PlayerSearchQuery = z.output<typeof PlayerSearchQuerySchema>;
export type PlayerCardSummary = z.infer<typeof PlayerCardSummarySchema>;
export type PlayerSearchResponse = z.infer<typeof PlayerSearchResponseSchema>;
export type PlayerDetail = z.infer<typeof PlayerDetailSchema>;
export type PlayerCardDetail = z.infer<typeof PlayerCardDetailSchema>;
export type PlayerAutoBuild = z.infer<typeof PlayerAutoBuildSchema>;
export type CardPackSummary = z.infer<typeof CardPackSummarySchema>;
export type CardPackListResponse = z.infer<typeof CardPackListResponseSchema>;
export type CardPackDetail = z.infer<typeof CardPackDetailSchema>;
export type CreatePlayerFavoriteRequest = z.infer<typeof CreatePlayerFavoriteRequestSchema>;
export type PlayerFavoriteListQuery = z.output<typeof PlayerFavoriteListQuerySchema>;
export type PlayerFavoriteStatusQuery = z.output<typeof PlayerFavoriteStatusQuerySchema>;
export type PlayerFavoriteItem = z.infer<typeof PlayerFavoriteItemSchema>;
export type PlayerFavoriteListResponse = z.infer<typeof PlayerFavoriteListResponseSchema>;
export type PlayerFavoriteStatusResponse = z.infer<typeof PlayerFavoriteStatusResponseSchema>;
