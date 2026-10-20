import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../database/prisma.service.js';

type SalaryTier = { minOverall: number; maxOverall: number; salaryMinor: number };

export function matchSalaryTier<T extends SalaryTier>(tiers: readonly T[], overall: number): T | null {
  return tiers.find((tier) => overall >= tier.minOverall && overall <= tier.maxOverall) ?? null;
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
