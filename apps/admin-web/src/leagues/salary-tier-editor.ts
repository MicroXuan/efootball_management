export type SalaryTierDraft = { minOverall: number | null; maxOverall: number | null; salaryMinor: number | null };

export function salaryTierError(tiers: SalaryTierDraft[]): string | null {
  if (!tiers.length) return '至少保留一个工资档位';
  let expectedMin = 0;
  for (const [index, tier] of tiers.entries()) {
    if (typeof tier.minOverall !== 'number' || typeof tier.maxOverall !== 'number' || typeof tier.salaryMinor !== 'number'
      || ![tier.minOverall, tier.maxOverall, tier.salaryMinor].every(Number.isInteger)) {
      return `第 ${index + 1} 档请填写整数`;
    }
    if (tier.minOverall !== expectedMin) {
      return `第 ${index + 1} 档应从 ${expectedMin} 分开始，档位之间不能留空或重叠`;
    }
    if (tier.maxOverall < tier.minOverall || tier.maxOverall > 120) {
      return `第 ${index + 1} 档的结束分须在 ${tier.minOverall}–120 之间`;
    }
    if (tier.salaryMinor < 1 || tier.salaryMinor > 4_294_967_295) {
      return `第 ${index + 1} 档的工资须为正整数`;
    }
    expectedMin = tier.maxOverall + 1;
  }
  return expectedMin === 121 ? null : '最后一档须覆盖到 120 分';
}

export function insertSalaryTier<T extends SalaryTierDraft>(tiers: T[], index: number, tier: T): T[] {
  return [...tiers.slice(0, index), tier, ...tiers.slice(index)];
}

export function removeSalaryTier<T extends SalaryTierDraft>(tiers: T[], index: number): T[] {
  if (tiers.length <= 1 || !tiers[index]) return tiers;
  return tiers.filter((_, at) => at !== index);
}
