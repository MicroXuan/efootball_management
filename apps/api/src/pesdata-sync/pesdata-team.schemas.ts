import { z } from 'zod';

const SourceIdSchema = z.union([z.string().trim().min(1), z.number().finite()]).transform(String);
const NullableText = z.string().trim().min(1).nullish().transform((value) => value ?? null);

export const PesdataLeagueSchema = z.object({
  league_id: SourceIdSchema.optional(),
  leagueId: SourceIdSchema.optional(),
  league_name: NullableText.optional(),
  leagueName: NullableText.optional()
}).passthrough().transform((value, context) => {
  const leagueId = value.league_id ?? value.leagueId;
  const leagueName = value.league_name ?? value.leagueName;
  if (!leagueId || !leagueName) {
    context.addIssue({ code: 'custom', message: 'PESDATA league requires an identifier and name' });
    return z.NEVER;
  }
  return { leagueId, leagueName };
});

export const PesdataTeamSchema = z.object({
  team_id: SourceIdSchema.optional(),
  teamId: SourceIdSchema.optional(),
  league_id: SourceIdSchema.nullish(),
  leagueId: SourceIdSchema.nullish(),
  league_name: NullableText.optional(),
  leagueName: NullableText.optional(),
  team_name: NullableText.optional(),
  teamName: NullableText.optional(),
  team_name_zh: NullableText.optional(),
  teamNameZh: NullableText.optional(),
  team_name_cn: NullableText.optional(),
  team_name_jp: NullableText.optional(),
  teamNameJa: NullableText.optional(),
  short_name: NullableText.optional(),
  shortName: NullableText.optional(),
  team_logo: z.url().nullish(),
  teamLogo: z.url().nullish(),
  updated_at: z.union([z.string(), z.number(), z.date()]).nullish(),
  updatedAt: z.union([z.string(), z.number(), z.date()]).nullish()
}).passthrough().transform((value, context) => {
  const teamId = value.team_id ?? value.teamId;
  const nameZh = value.team_name_zh ?? value.team_name_cn ?? value.teamNameZh ?? null;
  const nameEn = value.team_name ?? value.teamName ?? null;
  const nameJa = value.team_name_jp ?? value.teamNameJa ?? null;
  if (!teamId || !(nameZh ?? nameEn ?? nameJa)) {
    context.addIssue({ code: 'custom', message: 'PESDATA team requires an identifier and name' });
    return z.NEVER;
  }
  return {
    teamId,
    leagueId: value.league_id ?? value.leagueId ?? null,
    leagueName: value.league_name ?? value.leagueName ?? null,
    nameZh,
    nameEn,
    nameJa,
    shortName: value.short_name ?? value.shortName ?? null,
    teamLogo: value.team_logo ?? value.teamLogo ?? null,
    updatedAt: value.updated_at ?? value.updatedAt ?? null
  };
});

export const PesdataLeagueListEnvelopeSchema = z.object({
  code: z.literal(1),
  data: z.object({ list: z.array(PesdataLeagueSchema), count: z.coerce.number().int().nonnegative() }).passthrough()
}).passthrough();

export const PesdataTeamListEnvelopeSchema = z.object({
  code: z.literal(1),
  data: z.object({ list: z.array(PesdataTeamSchema), count: z.coerce.number().int().nonnegative() }).passthrough()
}).passthrough();

export const PesdataTeamDetailEnvelopeSchema = z.object({
  code: z.literal(1),
  data: z.array(PesdataTeamSchema)
}).passthrough();

export type PesdataLeague = z.infer<typeof PesdataLeagueSchema>;
export type PesdataTeam = z.infer<typeof PesdataTeamSchema>;
