import type { CompetitionStatus } from '@efm/contracts';
import { CompetitionError } from '../competition.errors.js';

const ALLOWED_TRANSITIONS: Readonly<Record<CompetitionStatus, readonly CompetitionStatus[]>> = {
  DRAFT: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
};

export function assertCompetitionTransition(
  from: CompetitionStatus,
  to: CompetitionStatus
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new CompetitionError(
      'COMPETITION_TRANSITION_INVALID',
      `Competition cannot transition from ${from} to ${to}`,
      409,
      { from, to }
    );
  }
}
