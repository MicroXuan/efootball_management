import { describe, expect, it } from 'vitest';
import { insertSalaryTier, removeSalaryTier, salaryTierError, type SalaryTierDraft } from './salary-tier-editor';

const custom = [
  { minOverall: 0, maxOverall: 88, salaryMinor: 100 },
  { minOverall: 89, maxOverall: 91, salaryMinor: 200 },
  { minOverall: 92, maxOverall: 93, salaryMinor: 300 },
  { minOverall: 94, maxOverall: 96, salaryMinor: 500 },
  { minOverall: 97, maxOverall: 98, salaryMinor: 700 },
  { minOverall: 99, maxOverall: 100, salaryMinor: 900 },
  { minOverall: 101, maxOverall: 120, salaryMinor: 1100 },
];

describe('salary tier editing', () => {
  it('accepts manually chosen ranges including a 101-and-above final tier', () => {
    expect(salaryTierError(custom)).toBeNull();
  });

  it('rejects gaps, overlaps, invalid salaries and an uncovered end', () => {
    expect(salaryTierError(custom.map((tier, at) => at === 1 ? { ...tier, minOverall: 90 } : tier))).toContain('不能留空或重叠');
    expect(salaryTierError(custom.map((tier, at) => at === 1 ? { ...tier, minOverall: 88 } : tier))).toContain('不能留空或重叠');
    expect(salaryTierError(custom.map((tier, at) => at === 1 ? { ...tier, salaryMinor: 0 } : tier))).toContain('正整数');
    expect(salaryTierError(custom.map((tier, at) => at === 6 ? { ...tier, maxOverall: 110 } : tier))).toContain('120');
  });

  it('adds a blank row without choosing boundaries and deletes without changing other rows', () => {
    const blank: SalaryTierDraft = { minOverall: null, maxOverall: null, salaryMinor: null };
    const inserted = insertSalaryTier<SalaryTierDraft>(custom, 1, blank);
    expect(inserted[1]).toEqual(blank);
    expect(inserted[0]).toEqual(custom[0]);
    expect(inserted[2]).toEqual(custom[1]);
    expect(salaryTierError(inserted)).toContain('请填写整数');
    expect(removeSalaryTier(inserted, 1)).toEqual(custom);
    expect(removeSalaryTier(custom, 0)[0]).toEqual(custom[1]);
    expect(salaryTierError(removeSalaryTier(custom, 0))).toContain('应从 0 分开始');
  });
});
