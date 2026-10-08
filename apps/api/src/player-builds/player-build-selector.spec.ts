import { selectBestCard, type BestCardCandidate } from './player-build-selector.js';

describe('selectBestCard', () => {
  const build = (
    externalId: string,
    maxOverall: number,
    releaseDate: string | null,
    algorithmVersion = 'pesdata-auto-v1'
  ): BestCardCandidate => ({
    autoBuildId: `build-${externalId}`,
    playerCardId: `card-${externalId}`,
    externalId,
    algorithmVersion,
    maxOverall,
    releaseDate: releaseDate ? new Date(`${releaseDate}T00:00:00.000Z`) : null
  });

  it('selects the strongest of all six Bonucci variants without dropping alternatives', () => {
    const variants = [
      build('bonucci-epic-87', 98, '2026-09-24'),
      build('bonucci-highlight-87', 96, '2026-07-01'),
      build('bonucci-epic-86', 97, '2025-12-01'),
      build('bonucci-base-82-a', 92, '2024-01-01'),
      build('bonucci-base-82-b', 91, '2023-01-01'),
      build('bonucci-base-82-c', 90, null)
    ];

    const selected = selectBestCard(variants);

    expect(selected?.playerCardId).toBe('card-bonucci-epic-87');
    expect(selected?.selectionReason.candidateCount).toBe(6);
    expect(variants).toHaveLength(6);
  });

  it('resolves equal maximum overall by release date, then external ID', () => {
    expect(selectBestCard([
      build('older-high-dt', 99, '2025-01-01'),
      build('newer-low-dt', 99, '2026-09-27')
    ])?.playerCardId).toBe('card-newer-low-dt');

    expect(selectBestCard([
      build('z-card', 99, '2026-09-27'),
      build('a-card', 99, '2026-09-27')
    ])?.playerCardId).toBe('card-a-card');
  });

  it('records a DT-free recommendation reason', () => {
    const selected = selectBestCard([build('winner', 99, '2026-09-27')]);

    expect(selected?.selectionReason.ordering).toEqual([
      'maxOverall:desc',
      'releaseDate:desc:nulls-last',
      'externalId:asc'
    ]);
    expect(selected?.selectionReason.winner).not.toHaveProperty('dtRating');
  });

  it('returns no recommendation when no automatic build exists', () => {
    expect(selectBestCard([])).toBeNull();
  });
});
