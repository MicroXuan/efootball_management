export type ValuationRule = {
  minimumValueMinor: number;
  maximumValueMinor: number;
  maximumIncreaseBps: number;
  maximumDecreaseBps: number;
};

export function valuationRange(baseValueMinor: number | null, rule: ValuationRule) {
  if (baseValueMinor === null) {
    return { minimum: rule.minimumValueMinor, maximum: rule.maximumValueMinor };
  }
  return {
    minimum: Math.max(
      rule.minimumValueMinor,
      Math.ceil(baseValueMinor * (10_000 - rule.maximumDecreaseBps) / 10_000)
    ),
    maximum: Math.min(
      rule.maximumValueMinor,
      Math.floor(baseValueMinor * (10_000 + rule.maximumIncreaseBps) / 10_000)
    )
  };
}
