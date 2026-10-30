import { z } from 'zod';
import { CompetitionListResponseSchema, CompetitionMatchResponseSchema, type CompetitionParticipantSummary, type SeasonFixtureListItem } from '@efm/contracts';
import type { AdminApi } from '../lib/api';
import { collectCursorPages } from '../lib/cursor-pages';

export type Fixture = SeasonFixtureListItem;
export const teamName = (team: CompetitionParticipantSummary) => `${team.teamNumber == null ? '' : `${team.teamNumber}号 · `}${team.teamName ?? team.displayName}`;

export async function loadFixtures(api: AdminApi, seasonId: string): Promise<Fixture[]> {
  const competitions = await collectCursorPages((cursor) => api.request(
    `/v1/competitions?${new URLSearchParams({ seasonId, limit: '100', ...(cursor ? { cursor } : {}) })}`,
    { schema: CompetitionListResponseSchema, skipAuth: true }
  ));
  const items: Fixture[] = [];
  // Limit fan-out for leagues with many cups; never show a partial schedule as complete.
  for (const competition of competitions) {
    if (competition.seasonId !== seasonId) continue;
    const matches = await api.request(`/v1/competitions/${competition.id}/matches`, {
      schema: z.array(CompetitionMatchResponseSchema), skipAuth: true
    });
    items.push(...matches.map((match) => ({ competition, match })));
  }
  return items.sort((a, b) => a.match.roundNumber - b.match.roundNumber || a.match.matchNumber - b.match.matchNumber);
}

export function filterFixtures(items: Fixture[], filter: { query: string; round: string; status: string }) {
  const query = filter.query.normalize('NFKC').trim().toLocaleLowerCase();
  return items.filter(({ match }) => (!filter.round || String(match.roundNumber) === filter.round)
    && (filter.status === 'ALL' || Boolean(match.officialResult || match.advancement) === (filter.status === 'FINISHED'))
    && (!query || [match.homeParticipant, match.awayParticipant].some((team) =>
      teamName(team).normalize('NFKC').toLocaleLowerCase().includes(query))));
}

export function canDecideAdvancement({ competition, match }: Fixture) {
  return ['SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(competition.format)
    && /^(ROUND_OF_(16|32|64|128)|QUARTER_FINAL|SEMI_FINAL|FINAL)$/.test(match.stageCode ?? '')
    && ['IN_PROGRESS', 'COMPLETED'].includes(competition.status);
}
