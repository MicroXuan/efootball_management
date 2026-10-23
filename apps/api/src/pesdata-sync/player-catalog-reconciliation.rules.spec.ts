import {
  classifyMissingCard,
  inspectScanPage,
  scheduledBusinessDate
} from './player-catalog-reconciliation.rules.js';

describe('player catalog reconciliation rules', () => {
  it('rejects a duplicate ID even when a page has the expected length', () => {
    expect(inspectScanPage({ offset: 0, limit: 2, count: 2, ids: ['11', '11'] }))
      .toBe('DUPLICATE_ID');
  });

  it('rejects a short page before the reported end of the list', () => {
    expect(inspectScanPage({ offset: 0, limit: 50, count: 100, ids: ['11'] }))
      .toBe('INCOMPLETE_PAGE');
  });

  it('never treats an ambiguous single-card result as proof of deletion on the first day', () => {
    expect(classifyMissingCard({ today: '2026-10-23', previousTrustedDate: null, previousMissing: false, detail: 'UNKNOWN' }))
      .toBe('REMOVAL_CANDIDATE');
  });

  it('allows delisting after two adjacent trustworthy business days of absence', () => {
    expect(classifyMissingCard({ today: '2026-10-23', previousTrustedDate: '2026-10-22', previousMissing: true, detail: 'UNKNOWN' }))
      .toBe('REMOVAL_CONFIRMED');
    expect(classifyMissingCard({ today: '2026-10-23', previousTrustedDate: '2026-10-21', previousMissing: true, detail: 'UNKNOWN' }))
      .toBe('REMOVAL_CANDIDATE');
  });

  it('uses the configured timezone for the scheduled business date', () => {
    expect(scheduledBusinessDate(new Date('2026-10-23T03:30:00Z'), 'America/New_York'))
      .toBe('2026-10-22');
  });
});
