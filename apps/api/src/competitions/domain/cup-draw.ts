export interface CupGroupAssignment {
  participantId: string;
  groupCode: string;
  seed: number;
}

export interface BuildBalancedCupGroupsInput {
  participantIds: string[];
  targetGroupSize: number;
  randomSeed: number;
}

export interface KnockoutQualifier {
  participantId: string;
  groupCode?: string;
  groupRank?: number;
}

export interface KnockoutPairing {
  pairingNumber: number;
  home: KnockoutQualifier | null;
  away: KnockoutQualifier | null;
}

export interface KnockoutDraw {
  bracketSize: number;
  byeCount: number;
  pairings: KnockoutPairing[];
}

export interface BuildKnockoutDrawInput {
  qualifiers: KnockoutQualifier[];
  randomSeed: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label}必须是正整数`);
  }
}

function assertUniqueParticipantIds(ids: string[]): void {
  const unique = new Set<string>();
  for (const id of ids) {
    if (!id.trim()) throw new Error('参赛方 ID 不能为空');
    if (unique.has(id)) throw new Error(`存在重复参赛方：${id}`);
    unique.add(id);
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

export function buildBalancedCupGroups(input: BuildBalancedCupGroupsInput): CupGroupAssignment[] {
  assertPositiveInteger(input.targetGroupSize, '目标小组人数');
  assertPositiveInteger(input.randomSeed, '随机种子');
  assertUniqueParticipantIds(input.participantIds);
  if (input.participantIds.length < 2) throw new Error('杯赛至少需要 2 支参赛方');

  const groupCount = Math.ceil(input.participantIds.length / input.targetGroupSize);
  const groupCodes = Array.from({ length: groupCount }, (_, index) => `GROUP_${groupSuffix(index)}`);
  const ordered = shuffled(input.participantIds, input.randomSeed, (id) => id);

  return ordered.map((participantId, index) => ({
    participantId,
    groupCode: groupCodes[index % groupCount]!,
    seed: Math.floor(index / groupCount) + 1
  }));
}

function nextPowerOfTwo(value: number): number {
  let power = 2;
  while (power < value) power *= 2;
  return power;
}

function pairSeededQualifiers(qualifiers: KnockoutQualifier[], seed: number): KnockoutPairing[] | null {
  const upper = qualifiers.filter(({ groupRank }) => groupRank === 1);
  const lower = qualifiers.filter(({ groupRank }) => groupRank === 2);
  if (upper.length < 2 || upper.length !== lower.length || upper.length + lower.length !== qualifiers.length) {
    return null;
  }

  const homes = shuffled(upper, seed, ({ participantId }) => participantId);
  const aways = shuffled(lower, seed ^ 0x9E3779B9, ({ participantId }) => participantId);
  let best = aways;
  let bestConflictCount = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < aways.length; offset += 1) {
    const candidate = aways.map((_, index) => aways[(index + offset) % aways.length]!);
    const conflictCount = homes.reduce(
      (count, home, index) => count + Number(home.groupCode === candidate[index]!.groupCode),
      0
    );
    if (conflictCount < bestConflictCount) {
      best = candidate;
      bestConflictCount = conflictCount;
    }
  }

  return homes.map((home, index) => ({ pairingNumber: index + 1, home, away: best[index]! }));
}

export function buildKnockoutDraw(input: BuildKnockoutDrawInput): KnockoutDraw {
  assertPositiveInteger(input.randomSeed, '随机种子');
  assertUniqueParticipantIds(input.qualifiers.map(({ participantId }) => participantId));
  if (input.qualifiers.length < 2) throw new Error('淘汰赛至少需要 2 支参赛方');

  const bracketSize = nextPowerOfTwo(input.qualifiers.length);
  const byeCount = bracketSize - input.qualifiers.length;
  const seededPairings = byeCount === 0 ? pairSeededQualifiers(input.qualifiers, input.randomSeed) : null;
  if (seededPairings) return { bracketSize, byeCount, pairings: seededPairings };

  const ordered = shuffled(input.qualifiers, input.randomSeed, ({ participantId }) => participantId);
  const byeRecipients = ordered.slice(0, byeCount);
  const competing = ordered.slice(byeCount);
  const pairings: KnockoutPairing[] = byeRecipients.map((home, index) => ({
    pairingNumber: index + 1,
    home,
    away: null
  }));
  for (let index = 0; index < competing.length; index += 2) {
    pairings.push({
      pairingNumber: pairings.length + 1,
      home: competing[index]!,
      away: competing[index + 1]!
    });
  }

  return { bracketSize, byeCount, pairings };
}
