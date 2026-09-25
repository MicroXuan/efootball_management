import type { CompetitionStatus } from '@efm/contracts';
import { assertCompetitionTransition } from './competition-state.js';

describe('competition lifecycle state machine', () => {
  const allowed: Array<[CompetitionStatus, CompetitionStatus]> = [
    ['DRAFT', 'REGISTRATION_OPEN'],
    ['DRAFT', 'CANCELLED'],
    ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'],
    ['REGISTRATION_OPEN', 'CANCELLED'],
    ['REGISTRATION_CLOSED', 'SCHEDULED'],
    ['REGISTRATION_CLOSED', 'CANCELLED'],
    ['SCHEDULED', 'IN_PROGRESS'],
    ['SCHEDULED', 'CANCELLED'],
    ['IN_PROGRESS', 'COMPLETED'],
    ['IN_PROGRESS', 'CANCELLED']
  ];

  it.each(allowed)('allows %s -> %s', (from, to) => {
    expect(() => assertCompetitionTransition(from, to)).not.toThrow();
  });

  it.each([
    ['DRAFT', 'REGISTRATION_CLOSED'],
    ['REGISTRATION_OPEN', 'IN_PROGRESS'],
    ['REGISTRATION_CLOSED', 'IN_PROGRESS'],
    ['SCHEDULED', 'COMPLETED'],
    ['COMPLETED', 'REGISTRATION_OPEN'],
    ['COMPLETED', 'CANCELLED'],
    ['CANCELLED', 'DRAFT']
  ] satisfies Array<[CompetitionStatus, CompetitionStatus]>)('rejects %s -> %s with diagnostics', (from, to) => {
    let thrown: unknown;
    try {
      assertCompetitionTransition(from, to);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      response: {
        code: 'COMPETITION_TRANSITION_INVALID',
        details: { from, to }
      },
      status: 409
    });
  });
});
