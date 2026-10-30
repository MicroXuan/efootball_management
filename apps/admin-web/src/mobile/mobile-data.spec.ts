import { describe, it, expect, vi } from 'vitest';
import type { AdminApi } from '../lib/api';
import { loadFixtures, filterFixtures } from './mobile-data';

describe('mobile fixture queries', () => {
  it('collects every competition page and only requests matches in the selected season', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes('/matches')) return [{ id: path, roundNumber: 1, matchNumber: 1 }];
      return path.includes('cursor=next')
        ? { items: [{ id: 'cup', name: '杯赛', seasonId: 's' }], nextCursor: null }
        : { items: [{ id: 'league', name: '联赛', seasonId: 's' }], nextCursor: 'next' };
    });
    const result = await loadFixtures({ request } as unknown as AdminApi, 's');
    expect(result).toHaveLength(2);
    expect(request).toHaveBeenCalledWith('/v1/competitions?seasonId=s&limit=100&cursor=next', expect.anything());
    expect(request).toHaveBeenCalledWith('/v1/competitions/cup/matches', expect.anything());
  });
  it('does not turn partial failures into an empty or incomplete schedule', async () => {
    const request = vi.fn().mockResolvedValueOnce({ items: [{ id: 'c', seasonId: 's' }], nextCursor: null }).mockRejectedValueOnce(new Error('offline'));
    await expect(loadFixtures({ request } as unknown as AdminApi, 's')).rejects.toThrow('offline');
  });
  it('filters by team number, round and official result, including 0–0', () => {
    const fixtures = [{ competition: { id: 'c' }, match: { roundNumber: 2, officialResult: { homeScore: 0, awayScore: 0 }, homeParticipant: { teamNumber: 7, displayName: '主队' }, awayParticipant: { displayName: '客队' } } }];
    expect(filterFixtures(fixtures as never, { query: '7', round: '2', status: 'FINISHED' })).toHaveLength(1);
    expect(filterFixtures(fixtures as never, { query: '', round: '', status: 'UPCOMING' })).toHaveLength(0);
  });
});

it('counts advancement decisions as finished results, not pending scores', () => {
  const fixtures = [{ competition: { id: 'c' }, match: { roundNumber: 1, officialResult: null, advancement: { winnerParticipantId: 'home', reason: '弃权' }, homeParticipant: { displayName: '主队' }, awayParticipant: { displayName: '客队' } } }];
  expect(filterFixtures(fixtures as never, { query: '', round: '', status: 'FINISHED' })).toHaveLength(1);
  expect(filterFixtures(fixtures as never, { query: '', round: '', status: 'UPCOMING' })).toHaveLength(0);
});

it('only offers advancement for a started knockout round', async () => {
  const { canDecideAdvancement } = await import('./mobile-data');
  const fixture = { competition: { format: 'GROUP_KNOCKOUT', status: 'IN_PROGRESS' }, match: { stageCode: 'SEMI_FINAL' } };
  expect(canDecideAdvancement(fixture as never)).toBe(true);
  expect(canDecideAdvancement({ ...fixture, match: { stageCode: 'GROUP_A' } } as never)).toBe(false);
  expect(canDecideAdvancement({ ...fixture, competition: { ...fixture.competition, status: 'PUBLISHED' } } as never)).toBe(false);
});
