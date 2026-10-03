import { describe, expect, it } from '@jest/globals';
import {
  buildFirstSeasonAllocation,
  buildRegularSeasonAllocation,
  rankCrossGroupCandidates,
  type AllocationEntry,
  type PreviousSeasonStanding
} from './allocation.js';

function entries(count: number, offset = 0): AllocationEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    seasonEntryId: `entry-${index + offset + 1}`,
    teamName: `球队 ${index + offset + 1}`
  }));
}

function countsByStage(result: ReturnType<typeof buildFirstSeasonAllocation>) {
  return result.reduce<Record<string, number>>((counts, item) => {
    counts[item.stageCode] = (counts[item.stageCode] ?? 0) + 1;
    return counts;
  }, {});
}

function standing(
  entry: AllocationEntry,
  stageCode: string,
  rank: number,
  played = 10,
  totalPoints = 30 - rank
): PreviousSeasonStanding {
  return {
    ...entry,
    stageCode,
    rank,
    played,
    totalPoints,
    goalDifference: 20 - rank,
    goalsFor: 30 - rank
  };
}

describe('tiered league allocation', () => {
  it.each([
    [1, [1]],
    [18, [18]],
    [19, [10, 9]],
    [25, [13, 12]],
    [36, [18, 18]],
    [37, [13, 12, 12]]
  ])('balances %i first-season teams without creating a super division', (count, expectedCounts) => {
    const result = buildFirstSeasonAllocation({
      entries: entries(count),
      championCapacity: 18,
      randomSeed: 20261003
    });

    expect(result).toHaveLength(count);
    expect(new Set(result.map((item) => item.seasonEntryId)).size).toBe(count);
    expect(result.some((item) => item.stageCode === 'SUPER')).toBe(false);
    expect(Object.values(countsByStage(result)).sort((a, b) => b - a)).toEqual(expectedCounts);
    expect(result.every((item) => item.source === 'FIRST_SEASON')).toBe(true);
  });

  it('is deterministic for one seed and changes the first-season order for another seed', () => {
    const input = { entries: entries(25), championCapacity: 18 };
    const first = buildFirstSeasonAllocation({ ...input, randomSeed: 11 });
    const replay = buildFirstSeasonAllocation({ ...input, randomSeed: 11 });
    const changed = buildFirstSeasonAllocation({ ...input, randomSeed: 12 });

    expect(replay).toEqual(first);
    expect(changed.map((item) => item.seasonEntryId)).not.toEqual(first.map((item) => item.seasonEntryId));
  });

  it('ranks cross-group candidates by rate metrics and marks only complete metric ties', () => {
    const ranked = rankCrossGroupCandidates([
      { ...standing(entries(1)[0]!, 'CHAMPION_A', 1, 10, 20), goalDifference: 5, goalsFor: 15 },
      { ...standing(entries(1, 1)[0]!, 'CHAMPION_B', 1, 8, 16), goalDifference: 4, goalsFor: 12 },
      { ...standing(entries(1, 2)[0]!, 'CHAMPION_C', 1, 10, 20), goalDifference: 5, goalsFor: 14 },
      { ...standing(entries(1, 3)[0]!, 'CHAMPION_A', 2, 10, 19), goalDifference: 20, goalsFor: 30 }
    ]);

    expect(ranked.map((row) => row.seasonEntryId)).toEqual(['entry-1', 'entry-2', 'entry-3', 'entry-4']);
    expect(ranked.map((row) => row.tiePending)).toEqual([true, true, false, false]);
    expect(ranked[0]).toMatchObject({ pointsPerMatch: 2, goalDifferencePerMatch: 0.5, goalsForPerMatch: 1.5 });
  });

  it('keeps, promotes, relegates, and fills vacancies from confirmed returning teams', () => {
    const superEntries = entries(23);
    const championEntries = entries(18, 23);
    const missingSuperIds = new Set(['entry-22', 'entry-23']);
    const currentEntries = [...superEntries.filter((entry) => !missingSuperIds.has(entry.seasonEntryId)), ...championEntries];
    const previousStandings = [
      ...superEntries.map((entry, index) => standing(entry, 'SUPER', index + 1)),
      ...championEntries.map((entry, index) => standing(entry, 'CHAMPION_A', index + 1))
    ];

    const result = buildRegularSeasonAllocation({
      entries: currentEntries,
      previousStandings,
      superCapacity: 23,
      championCapacity: 18,
      promotionCount: 4,
      randomSeed: 99
    });
    const superRows = result.filter((item) => item.stageCode === 'SUPER');

    expect(superRows).toHaveLength(23);
    expect(superRows.filter((item) => item.source === 'RETAINED')).toHaveLength(17);
    expect(superRows.filter((item) => item.source === 'PROMOTED')).toHaveLength(6);
    expect(result.filter((item) => item.source === 'RELEGATED')).toHaveLength(4);
    expect(new Set(result.map((item) => item.seasonEntryId)).size).toBe(currentEntries.length);
  });

  it('respects a reduced super capacity without dropping or duplicating teams', () => {
    const superEntries = entries(23);
    const championEntries = entries(8, 23);
    const all = [...superEntries, ...championEntries];
    const result = buildRegularSeasonAllocation({
      entries: all,
      previousStandings: [
        ...superEntries.map((entry, index) => standing(entry, 'SUPER', index + 1)),
        ...championEntries.map((entry, index) => standing(entry, 'CHAMPION_A', index + 1))
      ],
      superCapacity: 10,
      championCapacity: 9,
      promotionCount: 4,
      randomSeed: 9
    });

    expect(result.filter((item) => item.stageCode === 'SUPER')).toHaveLength(10);
    expect(result).toHaveLength(all.length);
    expect(new Set(result.map((item) => item.seasonEntryId)).size).toBe(all.length);
    const championCounts = Object.entries(countsByStage(result))
      .filter(([stageCode]) => stageCode.startsWith('CHAMPION_'))
      .map(([, count]) => count);
    expect(Math.max(...championCounts) - Math.min(...championCounts)).toBeLessThanOrEqual(1);
  });

  it('snake-distributes historical champion teams and evenly inserts seeded new teams', () => {
    const historical = entries(20);
    const newcomers = entries(5, 20);
    const result = buildRegularSeasonAllocation({
      entries: [...historical, ...newcomers],
      previousStandings: historical.map((entry, index) => standing(entry, 'CHAMPION_A', index + 1)),
      superCapacity: 4,
      championCapacity: 7,
      promotionCount: 4,
      randomSeed: 1234
    });
    const championRows = result.filter((item) => item.stageCode.startsWith('CHAMPION_'));
    const replay = buildRegularSeasonAllocation({
      entries: [...historical, ...newcomers],
      previousStandings: historical.map((entry, index) => standing(entry, 'CHAMPION_A', index + 1)),
      superCapacity: 4,
      championCapacity: 7,
      promotionCount: 4,
      randomSeed: 1234
    });

    expect(replay).toEqual(result);
    expect(championRows.filter((item) => item.source === 'NEW_ENTRY')).toHaveLength(5);
    const championCounts = Object.values(countsByStage(championRows));
    expect(Math.max(...championCounts) - Math.min(...championCounts)).toBeLessThanOrEqual(1);
    expect(championRows.find((item) => item.seasonEntryId === 'entry-5')?.stageCode).toBe('CHAMPION_A');
    expect(championRows.find((item) => item.seasonEntryId === 'entry-6')?.stageCode).toBe('CHAMPION_B');
  });

  it('rejects duplicate entry ids, invalid capacities, and duplicate historical standings', () => {
    expect(() => buildFirstSeasonAllocation({
      entries: [...entries(1), ...entries(1)],
      championCapacity: 18,
      randomSeed: 1
    })).toThrow('重复');
    expect(() => buildFirstSeasonAllocation({ entries: entries(1), championCapacity: 0, randomSeed: 1 })).toThrow('容量');
    expect(() => buildRegularSeasonAllocation({
      entries: entries(1),
      previousStandings: [standing(entries(1)[0]!, 'SUPER', 1), standing(entries(1)[0]!, 'SUPER', 1)],
      superCapacity: 23,
      championCapacity: 18,
      promotionCount: 4,
      randomSeed: 1
    })).toThrow('重复');
  });
});
