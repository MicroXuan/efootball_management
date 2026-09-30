import { selectBestCard, type BestCardCandidate } from './player-build-selector.js';

describe('selectBestCard', () => {
  const build = (
    externalId: string,
    maxOverall: number,
    dtRating: number | null,
    releaseDate: string | null,
    algorithmVersion = 'pesdata-auto-v1'
  ): BestCardCandidate => ({
    autoBuildId: `build-${externalId}`,
    playerCardId: `card-${externalId}`,
    externalId,
    algorithmVersion,
    maxOverall,
    dtRating,
    releaseDate: releaseDate ? new Date(`${releaseDate}T00:00:00.000Z`) : null
  });

  it('selects the strongest of all six Bonucci variants without dropping alternatives', () => {
    const variants = [
      build('bonucci-epic-87', 98, 97, '2026-09-24'),
      build('bonucci-highlight-87', 96, 96, '2026-07-01'),
      build('bonucci-epic-86', 97, 98, '2025-12-01'),
      build('bonucci-base-82-a', 92, 90, '2024-01-01'),
      build('bonucci-base-82-b', 91, 91, '2023-01-01'),
      build('bonucci-base-82-c', 90, 92, null)
    ];

    const selected = selectBestCard(variants);

    expect(selected?.playerCardId).toBe('card-bonucci-epic-87');
    expect(selected?.selectionReason.candidateCount).toBe(6);
    expect(variants).toHaveLength(6);
  });

  it('resolves equal maximum overall by DT, release date, then external ID', () => {
    expect(selectBestCard([
      build('dt-low', 99, 97, '2026-09-27'),
      build('dt-high', 99, 98, '2025-01-01')
    ])?.playerCardId).toBe('card-dt-high');

    expect(selectBestCard([
      build('older', 99, 98, '2025-01-01'),
      build('newer', 99, 98, '2026-09-27')
    ])?.playerCardId).toBe('card-newer');

    expect(selectBestCard([
      build('z-card', 99, 98, '2026-09-27'),
      build('a-card', 99, 98, '2026-09-27')
    ])?.playerCardId).toBe('card-a-card');
  });

  it('keeps a missing DT value unavailable and ranks it below a known DT on a tie', () => {
    const selected = selectBestCard([
      build('unknown-dt', 99, null, '2026-09-27'),
      build('known-dt', 99, 1, '2020-01-01')
    ]);

    expect(selected?.playerCardId).toBe('card-known-dt');
    expect(selected?.selectionReason.winner.dtRating).toBe(1);
  });

  it('returns no recommendation when no automatic build exists', () => {
    expect(selectBestCard([])).toBeNull();
  });
});
