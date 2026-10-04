import { valuationRange } from './valuation-calculator.js';

const rule = {
  minimumValueMinor: 100,
  maximumValueMinor: 10_000,
  maximumIncreaseBps: 1250,
  maximumDecreaseBps: 750
};

describe('valuationRange', () => {
  it('uses the global range for a first valuation', () => {
    expect(valuationRange(null, rule)).toEqual({ minimum: 100, maximum: 10_000 });
  });

  it('rounds the decrease upward and the increase downward', () => {
    expect(valuationRange(101, { ...rule, minimumValueMinor: 0 }))
      .toEqual({ minimum: 94, maximum: 113 });
  });

  it('clamps a calculated range to the global minimum and maximum', () => {
    expect(valuationRange(105, { ...rule, minimumValueMinor: 100, maximumDecreaseBps: 1000 }))
      .toEqual({ minimum: 100, maximum: 118 });
    expect(valuationRange(9500, { ...rule, maximumValueMinor: 10_000, maximumIncreaseBps: 2000 }))
      .toEqual({ minimum: 8788, maximum: 10_000 });
  });
});
