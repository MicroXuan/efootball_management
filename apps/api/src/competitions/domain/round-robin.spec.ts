import { generateRoundRobin } from './round-robin.js';

function groupByRound<T extends { roundNumber: number }>(items: T[]): T[][] {
  const rounds = new Map<number, T[]>();
  for (const item of items) {
    const round = rounds.get(item.roundNumber) ?? [];
    round.push(item);
    rounds.set(item.roundNumber, round);
  }
  return [...rounds.values()];
}

describe('round-robin generation', () => {
  it.each([
    [0, 0, 0],
    [1, 0, 0],
    [2, 1, 1],
    [3, 3, 3],
    [18, 153, 17],
    [23, 253, 23]
  ])('creates %i-player schedule with %i matches over %i rounds', (size, matches, rounds) => {
    const schedule = generateRoundRobin(Array.from({ length: size }, (_, index) => `p-${index + 1}`));
    expect(schedule).toHaveLength(matches);
    expect(Math.max(0, ...schedule.map((match) => match.roundNumber))).toBe(rounds);
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9])('creates every pairing once for %i participants', (size) => {
    const ids = Array.from({ length: size }, (_, index) => `participant-${index + 1}`);
    const schedule = generateRoundRobin(ids);

    expect(schedule).toHaveLength(size * (size - 1) / 2);
    expect(new Set(schedule.map(({ pairingKey }) => pairingKey)).size).toBe(schedule.length);
    for (const round of groupByRound(schedule)) {
      const appearances = round.flatMap(({ homeParticipantId, awayParticipantId }) => [
        homeParticipantId,
        awayParticipantId
      ]);
      expect(new Set(appearances).size).toBe(appearances.length);
    }
    expect(generateRoundRobin(ids)).toEqual(schedule);
    expect(ids).toEqual(Array.from({ length: size }, (_, index) => `participant-${index + 1}`));
  });

  it.each([3, 5, 7, 9])('omits exactly one participant per round for odd size %i', (size) => {
    const ids = Array.from({ length: size }, (_, index) => `participant-${index + 1}`);
    const rounds = groupByRound(generateRoundRobin(ids));

    expect(rounds).toHaveLength(size);
    for (const round of rounds) {
      const appearances = round.flatMap(({ homeParticipantId, awayParticipantId }) => [
        homeParticipantId,
        awayParticipantId
      ]);
      expect(appearances).toHaveLength(size - 1);
      expect(appearances).not.toContain('__BYE__');
    }
  });

  it('gives every participant exactly one bye in a 23-player group', () => {
    const ids = Array.from({ length: 23 }, (_, index) => `participant-${index + 1}`);
    const rounds = groupByRound(generateRoundRobin(ids));
    const byes = new Map(ids.map((id) => [id, 0]));
    for (const round of rounds) {
      const playing = new Set(round.flatMap((match) => [match.homeParticipantId, match.awayParticipantId]));
      for (const id of ids) if (!playing.has(id)) byes.set(id, byes.get(id)! + 1);
    }
    expect([...byes.values()]).toEqual(Array.from({ length: 23 }, () => 1));
  });

  it('sorts a copy before assigning stable match numbers and pairing keys', () => {
    const ids = ['c', 'a', 'd', 'b'];
    const original = [...ids];
    const schedule = generateRoundRobin(ids);

    expect(ids).toEqual(original);
    expect(schedule.map(({ matchNumber }) => matchNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(schedule.every(({ homeParticipantId, awayParticipantId, pairingKey }) => (
      pairingKey === [homeParticipantId, awayParticipantId].sort().join(':')
    ))).toBe(true);
  });
});
