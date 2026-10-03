export type AllocationSource =
  | 'FIRST_SEASON'
  | 'RETAINED'
  | 'PROMOTED'
  | 'RELEGATED'
  | 'REPLACEMENT'
  | 'CHAMPION_POOL'
  | 'NEW_ENTRY';

export interface AllocationEntry {
  seasonEntryId: string;
  teamName: string;
}

export interface PreviousSeasonStanding extends AllocationEntry {
  stageCode: string;
  rank: number;
  played: number;
  totalPoints: number;
  goalDifference: number;
  goalsFor: number;
}

export interface CrossGroupRank extends PreviousSeasonStanding {
  crossGroupRank: number;
  pointsPerMatch: number;
  goalDifferencePerMatch: number;
  goalsForPerMatch: number;
  tiePending: boolean;
}

export interface AllocationSuggestion extends AllocationEntry {
  stageCode: string;
  source: AllocationSource;
  previousRank: number | null;
  pointsPerMatch: number | null;
  goalDifferencePerMatch: number | null;
  goalsForPerMatch: number | null;
  tiePending: boolean;
  reason: string;
}

export interface FirstSeasonAllocationInput {
  entries: AllocationEntry[];
  championCapacity: number;
  randomSeed: number;
}

export interface RegularSeasonAllocationInput extends FirstSeasonAllocationInput {
  previousStandings: PreviousSeasonStanding[];
  superCapacity: number;
  promotionCount: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label}容量必须是正整数`);
  }
}

function assertEntries(entries: AllocationEntry[]): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.seasonEntryId.trim()) {
      throw new Error('赛季资格 ID 不能为空');
    }
    if (ids.has(entry.seasonEntryId)) {
      throw new Error(`存在重复赛季资格：${entry.seasonEntryId}`);
    }
    ids.add(entry.seasonEntryId);
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(values: T[], seed: number, stableKey: (value: T) => string): T[] {
  const result = [...values].sort((left, right) => stableKey(left).localeCompare(stableKey(right)));
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function groupSuffix(index: number): string {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

function championStageCodes(teamCount: number, capacity: number): string[] {
  if (teamCount === 0) return [];
  const groupCount = Math.ceil(teamCount / capacity);
  return Array.from({ length: groupCount }, (_, index) => `CHAMPION_${groupSuffix(index)}`);
}

function balancedTargets(teamCount: number, groupCount: number): number[] {
  if (groupCount === 0) return [];
  const base = Math.floor(teamCount / groupCount);
  const remainder = teamCount % groupCount;
  return Array.from({ length: groupCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function emptyMetrics(entry: AllocationEntry, stageCode: string, source: AllocationSource, reason: string): AllocationSuggestion {
  return {
    ...entry,
    stageCode,
    source,
    previousRank: null,
    pointsPerMatch: null,
    goalDifferencePerMatch: null,
    goalsForPerMatch: null,
    tiePending: false,
    reason
  };
}

export function buildFirstSeasonAllocation(input: FirstSeasonAllocationInput): AllocationSuggestion[] {
  assertPositiveInteger(input.championCapacity, '冠军组');
  assertPositiveInteger(input.randomSeed, '随机种子');
  assertEntries(input.entries);

  const stageCodes = championStageCodes(input.entries.length, input.championCapacity);
  const targets = balancedTargets(input.entries.length, stageCodes.length);
  const counts = stageCodes.map(() => 0);
  const ordered = shuffled(input.entries, input.randomSeed, (entry) => entry.seasonEntryId);

  return ordered.map((entry, index) => {
    let groupIndex = index % stageCodes.length;
    while (counts[groupIndex]! >= targets[groupIndex]!) {
      groupIndex = (groupIndex + 1) % stageCodes.length;
    }
    counts[groupIndex] = counts[groupIndex]! + 1;
    return emptyMetrics(entry, stageCodes[groupIndex]!, 'FIRST_SEASON', '首赛季随机均衡分入冠军组');
  });
}

function rate(value: number, played: number): number {
  return played > 0 ? value / played : 0;
}

function sameMetrics(left: CrossGroupRank, right: CrossGroupRank): boolean {
  return left.pointsPerMatch === right.pointsPerMatch
    && left.goalDifferencePerMatch === right.goalDifferencePerMatch
    && left.goalsForPerMatch === right.goalsForPerMatch;
}

export function rankCrossGroupCandidates(rows: PreviousSeasonStanding[]): CrossGroupRank[] {
  const ids = new Set<string>();
  const ranked = rows.map((row) => {
    if (ids.has(row.seasonEntryId)) {
      throw new Error(`存在重复历史资格：${row.seasonEntryId}`);
    }
    ids.add(row.seasonEntryId);
    if (!Number.isInteger(row.rank) || row.rank < 1 || !Number.isInteger(row.played) || row.played < 0) {
      throw new Error('历史排名和比赛场次必须是有效整数');
    }
    return {
      ...row,
      crossGroupRank: 0,
      pointsPerMatch: rate(row.totalPoints, row.played),
      goalDifferencePerMatch: rate(row.goalDifference, row.played),
      goalsForPerMatch: rate(row.goalsFor, row.played),
      tiePending: false
    };
  }).sort((left, right) => (
    right.pointsPerMatch - left.pointsPerMatch
    || right.goalDifferencePerMatch - left.goalDifferencePerMatch
    || right.goalsForPerMatch - left.goalsForPerMatch
    || left.stageCode.localeCompare(right.stageCode)
    || left.rank - right.rank
    || left.seasonEntryId.localeCompare(right.seasonEntryId)
  ));

  return ranked.map((row, index, all) => ({
    ...row,
    crossGroupRank: index + 1,
    tiePending: (index > 0 && sameMetrics(row, all[index - 1]!))
      || (index < all.length - 1 && sameMetrics(row, all[index + 1]!))
  }));
}

function suggestionFromStanding(
  row: CrossGroupRank,
  stageCode: string,
  source: AllocationSource,
  reason: string
): AllocationSuggestion {
  return {
    seasonEntryId: row.seasonEntryId,
    teamName: row.teamName,
    stageCode,
    source,
    previousRank: row.rank,
    pointsPerMatch: row.pointsPerMatch,
    goalDifferencePerMatch: row.goalDifferencePerMatch,
    goalsForPerMatch: row.goalsForPerMatch,
    tiePending: row.tiePending,
    reason
  };
}

function assignChampionGroups(
  candidates: Array<{ entry: AllocationEntry; standing: CrossGroupRank | null; source: AllocationSource }>,
  championCapacity: number,
  randomSeed: number
): AllocationSuggestion[] {
  const stageCodes = championStageCodes(candidates.length, championCapacity);
  const targets = balancedTargets(candidates.length, stageCodes.length);
  const groups = stageCodes.map(() => [] as typeof candidates);
  const historical = candidates.filter((candidate) => candidate.standing !== null);
  const newcomers = shuffled(
    candidates.filter((candidate) => candidate.standing === null),
    randomSeed,
    (candidate) => candidate.entry.seasonEntryId
  );

  let forward = true;
  let cursor = 0;
  for (const candidate of historical) {
    while (groups[cursor]!.length >= targets[cursor]!) {
      cursor += forward ? 1 : -1;
      if (cursor >= groups.length) {
        forward = false;
        cursor = groups.length - 1;
      } else if (cursor < 0) {
        forward = true;
        cursor = 0;
      }
    }
    groups[cursor]!.push(candidate);
    cursor += forward ? 1 : -1;
    if (cursor >= groups.length) {
      forward = false;
      cursor = groups.length - 1;
    } else if (cursor < 0) {
      forward = true;
      cursor = 0;
    }
  }

  for (const candidate of newcomers) {
    const groupIndex = groups.reduce((best, group, index) => {
      if (group.length >= targets[index]!) return best;
      if (best === -1 || group.length < groups[best]!.length) return index;
      return best;
    }, -1);
    groups[groupIndex]!.push(candidate);
  }

  return groups.flatMap((group, groupIndex) => group.map((candidate) => {
    const reason = candidate.source === 'RELEGATED'
      ? '上赛季超级组降级进入冠军组'
      : candidate.source === 'CHAMPION_POOL'
        ? '依据上赛季冠军组跨组成绩蛇形分组'
        : '新球队按随机种子均衡插入冠军组';
    return candidate.standing
      ? suggestionFromStanding(candidate.standing, stageCodes[groupIndex]!, candidate.source, reason)
      : emptyMetrics(candidate.entry, stageCodes[groupIndex]!, candidate.source, reason);
  }));
}

export function buildRegularSeasonAllocation(input: RegularSeasonAllocationInput): AllocationSuggestion[] {
  assertPositiveInteger(input.superCapacity, '超级组');
  assertPositiveInteger(input.championCapacity, '冠军组');
  assertPositiveInteger(input.randomSeed, '随机种子');
  if (!Number.isInteger(input.promotionCount) || input.promotionCount < 0) {
    throw new Error('升降级人数必须是非负整数');
  }
  assertEntries(input.entries);

  const currentById = new Map(input.entries.map((entry) => [entry.seasonEntryId, entry]));
  const rankedPrevious = rankCrossGroupCandidates(input.previousStandings)
    .filter((row) => currentById.has(row.seasonEntryId));
  const previousById = new Map(rankedPrevious.map((row) => [row.seasonEntryId, row]));
  const renewedSuper = rankedPrevious
    .filter((row) => row.stageCode === 'SUPER')
    .sort((left, right) => left.rank - right.rank || left.seasonEntryId.localeCompare(right.seasonEntryId));
  const rankedChampion = rankedPrevious.filter((row) => row.stageCode.startsWith('CHAMPION_'));

  const guaranteedPromotions = Math.min(input.promotionCount, rankedChampion.length, input.superCapacity);
  const retainedLimit = Math.max(0, input.superCapacity - guaranteedPromotions);
  const baseRetainedCount = Math.max(0, renewedSuper.length - input.promotionCount);
  const retained = renewedSuper.slice(0, Math.min(baseRetainedCount, retainedLimit));
  const promoted = rankedChampion.slice(0, Math.min(rankedChampion.length, input.superCapacity - retained.length));
  const selectedIds = new Set([...retained, ...promoted].map((row) => row.seasonEntryId));
  const replacement = renewedSuper
    .filter((row) => !selectedIds.has(row.seasonEntryId))
    .slice(0, Math.max(0, input.superCapacity - selectedIds.size));
  replacement.forEach((row) => selectedIds.add(row.seasonEntryId));

  const superSuggestions = [
    ...retained.map((row) => suggestionFromStanding(row, 'SUPER', 'RETAINED', '上赛季超级组保留')),
    ...promoted.map((row) => suggestionFromStanding(row, 'SUPER', 'PROMOTED', '依据冠军组跨组成绩升级')),
    ...replacement.map((row) => suggestionFromStanding(row, 'SUPER', 'REPLACEMENT', '超级组缺员补位保留'))
  ];

  const championCandidates = input.entries
    .filter((entry) => !selectedIds.has(entry.seasonEntryId))
    .map((entry) => {
      const standing = previousById.get(entry.seasonEntryId) ?? null;
      const source: AllocationSource = standing?.stageCode === 'SUPER'
        ? 'RELEGATED'
        : standing
          ? 'CHAMPION_POOL'
          : 'NEW_ENTRY';
      return { entry, standing, source };
    })
    .sort((left, right) => {
      if (left.standing && right.standing) {
        if (left.source !== right.source) return left.source === 'RELEGATED' ? -1 : 1;
        return left.standing.crossGroupRank - right.standing.crossGroupRank;
      }
      if (left.standing) return -1;
      if (right.standing) return 1;
      return 0;
    });

  return [
    ...superSuggestions,
    ...assignChampionGroups(championCandidates, input.championCapacity, input.randomSeed)
  ];
}
