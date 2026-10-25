import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../database/prisma.service.js';

type SalaryTier = { minOverall: number; maxOverall: number; salaryMinor: number };

export function matchSalaryTier<T extends SalaryTier>(tiers: readonly T[], overall: number): T | null {
  return tiers.find((tier) => overall >= tier.minOverall && overall <= tier.maxOverall) ?? null;
}

export function birdSalaryQuote(tiers: readonly SalaryTier[], overall: number, baseline: number | null | undefined) {
  const current = matchSalaryTier(tiers, overall);
  if (!current) return null;
  const sorted = [...tiers].sort((a, b) => a.minOverall - b.minOverall);
  const index = sorted.findIndex((tier) => overall >= tier.minOverall && overall <= tier.maxOverall);
  const previous = baseline !== null && baseline !== undefined && overall > baseline && index > 0
    ? sorted[index - 1]
    : null;
  const birdDiscountApplied = previous !== null && previous !== undefined && previous.salaryMinor < current.salaryMinor;
  return {
    salaryMinor: birdDiscountApplied ? previous.salaryMinor : current.salaryMinor,
    birdDiscountApplied
  };
}

export function findActiveSalaryRule(
  client: PrismaService | Prisma.TransactionClient,
  leagueId: string,
  at: Date
) {
  return client.leagueSalaryRuleVersion.findFirst({
    where: { leagueId, status: 'ACTIVE', effectiveAt: { lte: at } },
    orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }],
    include: { tiers: { orderBy: { minOverall: 'asc' } } }
  });
}
