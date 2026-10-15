import { reconcileForcedApplication, sortForcedQueue } from './forced-transfer-policy.js';

const now = new Date('2026-10-14T12:00:00.000Z');
const base = {
  now,
  windowEndsAt: new Date(now.getTime() + 60_000),
  amountMinor: 500,
  currentOfficialValueMinor: 500,
  valuationVersionSnapshot: 2,
  currentValuationVersion: 2,
  ownershipIdSnapshot: 'ownership-1',
  ownershipVersionSnapshot: 3,
  currentOwnershipId: 'ownership-1',
  currentOwnershipVersion: 3,
  currentOwnershipStatus: 'ACTIVE' as const
};

describe('forced transfer policy', () => {
  it('requires a requote after an official valuation increase', () => {
    expect(reconcileForcedApplication({ ...base, currentOfficialValueMinor: 700, currentValuationVersion: 3 }))
      .toEqual({ status: 'REQUOTE_REQUIRED', reason: 'OFFICIAL_VALUE_INCREASED' });
  });

  it('does not lower an existing bid after valuation decreases', () => {
    expect(reconcileForcedApplication({ ...base, currentOfficialValueMinor: 300, currentValuationVersion: 3 }))
      .toEqual({ status: 'PENDING', reason: null });
  });

  it('marks stale or inactive ownership instead of retargeting it', () => {
    expect(reconcileForcedApplication({ ...base, currentOwnershipVersion: 4 }))
      .toEqual({ status: 'OWNERSHIP_CHANGED', reason: 'OWNERSHIP_VERSION_CHANGED' });
    expect(reconcileForcedApplication({ ...base, currentOwnershipStatus: 'RELEASED' }))
      .toEqual({ status: 'OWNERSHIP_CHANGED', reason: 'OWNERSHIP_NO_LONGER_ACTIVE' });
  });

  it('expires at the exact window end', () => {
    expect(reconcileForcedApplication({ ...base, windowEndsAt: now }))
      .toEqual({ status: 'EXPIRED', reason: 'TRANSFER_WINDOW_CLOSED' });
  });

  it('sorts by first valid submission and then application id without mutating input', () => {
    const items = [
      { id: 'b', firstValidSubmittedAt: now },
      { id: 'a', firstValidSubmittedAt: now },
      { id: 'c', firstValidSubmittedAt: new Date(now.getTime() - 1) }
    ] as const;
    expect(sortForcedQueue(items).map(({ id }) => id)).toEqual(['c', 'a', 'b']);
    expect(items.map(({ id }) => id)).toEqual(['b', 'a', 'c']);
  });
});
