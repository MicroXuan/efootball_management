import { describe, expect, it } from '@jest/globals';
import { buildBalancedCupGroups, buildKnockoutDraw } from './cup-draw.js';

function participantIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `participant-${index + 1}`);
}

describe('cup draw', () => {
  it.each([
    [8, 4, [4, 4]],
    [10, 4, [4, 3, 3]],
    [17, 4, [4, 4, 3, 3, 3]]
  ])('balances %i participants around target group size %i', (count, targetGroupSize, expectedSizes) => {
    const assignments = buildBalancedCupGroups({
      participantIds: participantIds(count),
      targetGroupSize,
      randomSeed: 20261003
    });
    const sizes = Object.values(assignments.reduce<Record<string, number>>((result, assignment) => {
      result[assignment.groupCode] = (result[assignment.groupCode] ?? 0) + 1;
      return result;
    }, {})).sort((left, right) => right - left);

    expect(assignments).toHaveLength(count);
    expect(new Set(assignments.map(({ participantId }) => participantId)).size).toBe(count);
    expect(sizes).toEqual(expectedSizes);
  });

  it('replays one group draw from its seed and changes order for a different seed', () => {
    const input = { participantIds: participantIds(12), targetGroupSize: 4 };
    const first = buildBalancedCupGroups({ ...input, randomSeed: 41 });
    const replay = buildBalancedCupGroups({ ...input, randomSeed: 41 });
    const changed = buildBalancedCupGroups({ ...input, randomSeed: 42 });

    expect(replay).toEqual(first);
    expect(changed).not.toEqual(first);
  });

  it('pairs group winners with runners-up without same-group matches when a solution exists', () => {
    const draw = buildKnockoutDraw({
      qualifiers: [
        { participantId: 'a1', groupCode: 'GROUP_A', groupRank: 1 },
        { participantId: 'a2', groupCode: 'GROUP_A', groupRank: 2 },
        { participantId: 'b1', groupCode: 'GROUP_B', groupRank: 1 },
        { participantId: 'b2', groupCode: 'GROUP_B', groupRank: 2 },
        { participantId: 'c1', groupCode: 'GROUP_C', groupRank: 1 },
        { participantId: 'c2', groupCode: 'GROUP_C', groupRank: 2 },
        { participantId: 'd1', groupCode: 'GROUP_D', groupRank: 1 },
        { participantId: 'd2', groupCode: 'GROUP_D', groupRank: 2 }
      ],
      randomSeed: 9
    });

    expect(draw.bracketSize).toBe(8);
    expect(draw.byeCount).toBe(0);
    expect(draw.pairings).toHaveLength(4);
    expect(draw.pairings.every((pairing) => pairing.home?.groupRank === 1)).toBe(true);
    expect(draw.pairings.every((pairing) => pairing.away?.groupRank === 2)).toBe(true);
    expect(draw.pairings.every((pairing) => pairing.home?.groupCode !== pairing.away?.groupCode)).toBe(true);
  });

  it.each([
    [3, 4, 1],
    [5, 8, 3],
    [6, 8, 2],
    [10, 16, 6],
    [12, 16, 4]
  ])('creates a %i-slot draw with the correct randomized byes for %i qualifiers', (qualifierCount, bracketSize, byeCount) => {
    const draw = buildKnockoutDraw({
      qualifiers: participantIds(qualifierCount).map((participantId) => ({ participantId })),
      randomSeed: 17
    });
    const entered = draw.pairings.flatMap(({ home, away }) => [home?.participantId, away?.participantId]).filter(Boolean);

    expect(draw.bracketSize).toBe(bracketSize);
    expect(draw.byeCount).toBe(byeCount);
    expect(draw.pairings).toHaveLength(bracketSize / 2);
    expect(new Set(entered).size).toBe(qualifierCount);
    expect(entered).toHaveLength(qualifierCount);
  });

  it('rejects duplicate participants and inputs too small to compete', () => {
    expect(() => buildBalancedCupGroups({
      participantIds: ['same', 'same'],
      targetGroupSize: 4,
      randomSeed: 1
    })).toThrow('重复');
    expect(() => buildKnockoutDraw({ qualifiers: [{ participantId: 'only-one' }], randomSeed: 1 })).toThrow('至少');
  });
});
