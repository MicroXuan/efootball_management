import type { LeagueSeasonStatus } from '@efm/contracts';
import { assertSeasonTransition, isRegistrationMutable } from './season-state.js';

describe('league season state', () => {
  it.each([
    ['DRAFT', 'REGISTRATION_OPEN'],
    ['DRAFT', 'CANCELLED'],
    ['REGISTRATION_OPEN', 'ALLOCATION_REVIEW'],
    ['REGISTRATION_OPEN', 'CANCELLED'],
    ['ALLOCATION_REVIEW', 'READY'],
    ['ALLOCATION_REVIEW', 'CANCELLED'],
    ['READY', 'ALLOCATION_REVIEW']
  ] satisfies Array<[LeagueSeasonStatus, LeagueSeasonStatus]>)('allows %s -> %s', (current, target) => {
    expect(() => assertSeasonTransition(current, target)).not.toThrow();
  });

  it.each([
    ['DRAFT', 'READY'],
    ['DRAFT', 'IN_PROGRESS'],
    ['REGISTRATION_OPEN', 'COMPLETED'],
    ['READY', 'COMPLETED'],
    ['CANCELLED', 'DRAFT'],
    ['COMPLETED', 'CANCELLED']
  ] satisfies Array<[LeagueSeasonStatus, LeagueSeasonStatus]>)('rejects %s -> %s in phase one', (current, target) => {
    expect(() => assertSeasonTransition(current, target)).toThrow(
      expect.objectContaining({ code: 'INVALID_SEASON_TRANSITION' })
    );
  });

  it('allows player registration mutations only while registration is open', () => {
    expect(isRegistrationMutable('REGISTRATION_OPEN')).toBe(true);
    expect(isRegistrationMutable('DRAFT')).toBe(false);
    expect(isRegistrationMutable('ALLOCATION_REVIEW')).toBe(false);
    expect(isRegistrationMutable('CANCELLED')).toBe(false);
  });
});
