import type { PlayerCardType, PlayerPosition } from './player-catalog.js';

export const PESDATA_POSITION_AUTO_BUILD_VERSION = 'pesdata-position-auto-v1';

export type DerivedPlayerAutoBuild = {
  allocation: Record<string, number>;
  maxOverall: number;
  dtRating: number;
  algorithmVersion: typeof PESDATA_POSITION_AUTO_BUILD_VERSION;
};

const categoryKeys = [
  'dribbling',
  'dexterity',
  'shooting',
  'lowerBodyStrength',
  'passing',
  'aerialStrength',
  'defending',
  'goalkeeping1',
  'goalkeeping2',
  'goalkeeping3'
] as const;

const automaticBuildWeights: Record<PlayerPosition, readonly number[]> = {
  GK: [13, 40, 0, 66, 67, 213, 13, 412, 399, 399],
  CB: [41, 164, 55, 231, 109, 368, 573, 0, 0, 0],
  LB: [184, 269, 72, 440, 208, 159, 294, 0, 0, 0],
  RB: [184, 269, 72, 440, 208, 159, 294, 0, 0, 0],
  DMF: [183, 134, 61, 306, 244, 220, 464, 0, 0, 0],
  CMF: [318, 208, 97, 330, 367, 85, 233, 0, 0, 0],
  LMF: [354, 318, 134, 367, 331, 48, 109, 0, 0, 0],
  RMF: [354, 318, 134, 367, 331, 48, 109, 0, 0, 0],
  AMF: [391, 281, 208, 257, 355, 60, 84, 0, 0, 0],
  LWF: [404, 391, 183, 330, 171, 85, 60, 0, 0, 0],
  RWF: [404, 391, 183, 330, 171, 85, 60, 0, 0, 0],
  SS: [419, 346, 308, 234, 173, 99, 36, 0, 0, 0],
  CF: [222, 419, 382, 259, 49, 210, 36, 0, 0, 0]
};

export function derivePesdataPositionAutoBuild(input: {
  position: PlayerPosition;
  overallRating: number;
  maxLevel: number | string | null | undefined;
  cardType?: PlayerCardType;
}): DerivedPlayerAutoBuild | null {
  if (input.cardType === 'TRENDING') return null;
  const maxLevel = typeof input.maxLevel === 'number'
    ? input.maxLevel
    : typeof input.maxLevel === 'string' && input.maxLevel.trim()
      ? Number(input.maxLevel)
      : Number.NaN;
  if (!Number.isFinite(maxLevel) || maxLevel <= 0) return null;

  const baseWeights = automaticBuildWeights[input.position];
  const weights = [...baseWeights];
  const levels = new Array(categoryKeys.length).fill(0) as number[];
  let remaining = Math.max(0, Math.floor(maxLevel));

  for (let pass = 0; pass < categoryKeys.length; pass += 1) {
    while (remaining > 0) {
      const currentWeight = [...weights].sort((left, right) => right - left)[pass];
      const category = weights.indexOf(currentWeight ?? -1);
      if (category < 0) break;
      const cost = Math.ceil((levels[category]! + 1) / 4);
      if (remaining < cost) break;
      levels[category] = levels[category]! + 1;
      remaining -= Math.ceil(levels[category]! / 4);
      weights[category] = Math.floor(baseWeights[category]! / Math.ceil((levels[category]! + 1) / 4));
    }
  }

  const allocation = Object.fromEntries(
    categoryKeys.map((key, index) => [key, levels[index] ?? 0])
  );
  const allocatedLevels = Object.values(allocation).reduce((sum, level) => sum + level, 0);
  const maxOverall = Math.min(110, input.overallRating + Math.round(allocatedLevels / 3.15));

  return {
    allocation,
    maxOverall,
    dtRating: maxOverall,
    algorithmVersion: PESDATA_POSITION_AUTO_BUILD_VERSION
  };
}
