import { jest } from '@jest/globals';
import { birdSalaryQuote, findActiveSalaryRule, matchSalaryTier } from './salary-quote.js';
import { SalaryRulesService } from './salary-rules.service.js';

const at = new Date('2026-10-20T12:00:00.000Z');
const tiers = [
  { minOverall: 0, maxOverall: 92, salaryMinor: 100 },
  { minOverall: 93, maxOverall: 120, salaryMinor: 200 }
];

describe('shared salary quote', () => {
  it('discounts one configured tier only when overall rose on the same team', () => {
    const cellTiers = [
      { minOverall: 0, maxOverall: 88, salaryMinor: 100 },
      { minOverall: 89, maxOverall: 91, salaryMinor: 200 },
      { minOverall: 92, maxOverall: 93, salaryMinor: 300 },
      { minOverall: 94, maxOverall: 96, salaryMinor: 500 },
      { minOverall: 97, maxOverall: 98, salaryMinor: 700 }
    ];
    expect(birdSalaryQuote(cellTiers, 98, 90)).toEqual({ salaryMinor: 500, birdDiscountApplied: true });
    expect(birdSalaryQuote(cellTiers, 98, 98)).toEqual({ salaryMinor: 700, birdDiscountApplied: false });
    expect(birdSalaryQuote(cellTiers, 88, 80)).toEqual({ salaryMinor: 100, birdDiscountApplied: false });
    expect(birdSalaryQuote([{ minOverall: 0, maxOverall: 90, salaryMinor: 100 }, { minOverall: 91, maxOverall: 99, salaryMinor: 100 }], 93, 90))
      .toEqual({ salaryMinor: 100, birdDiscountApplied: false });
  });
  it('matches both sides of a salary boundary without inventing a missing tier', () => {
    expect(matchSalaryTier(tiers, 92)?.salaryMinor).toBe(100);
    expect(matchSalaryTier(tiers, 93)?.salaryMinor).toBe(200);
    expect(matchSalaryTier(tiers, 121)).toBeNull();
  });

  it('selects only the latest effective active rule in the requested league', async () => {
    const rule = { id: 'rule-2', version: 2, effectiveAt: at, tiers };
    const findFirst = jest.fn(async () => rule);
    const result = await findActiveSalaryRule({ leagueSalaryRuleVersion: { findFirst } } as never, 'league-1', at);
    expect(result).toBe(rule);
    expect(findFirst).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', status: 'ACTIVE', effectiveAt: { lte: at } },
      orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }],
      include: { tiers: { orderBy: { minOverall: 'asc' } } }
    });
    findFirst.mockResolvedValueOnce(null as never);
    await expect(findActiveSalaryRule({ leagueSalaryRuleVersion: { findFirst } } as never, 'league-1', at)).resolves.toBeNull();
  });

  it('preserves the existing missing-rule and missing-tier errors at purchase review', async () => {
    const findFirst = jest.fn(async () => null as { id: string; version: number; salaryCapMinor: number; tiers: typeof tiers } | null);
    const prisma = { leagueSalaryRuleVersion: { findFirst } };
    const visibility = { requireVisible: jest.fn(async () => 'league-1') };
    const service = new SalaryRulesService(prisma as never, {} as never, {} as never, visibility as never);
    await expect(service.quoteWithClient(prisma as never, 'league-1', 93, at))
      .rejects.toMatchObject({ code: 'SALARY_RULE_NOT_CONFIGURED' });
    findFirst.mockResolvedValueOnce({ id: 'rule-2', version: 2, salaryCapMinor: 1000, tiers: [] });
    await expect(service.quoteWithClient(prisma as never, 'league-1', 93, at))
      .rejects.toMatchObject({ code: 'SALARY_TIER_NOT_CONFIGURED' });
  });
});
