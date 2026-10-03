import type { LeagueSeasonStatus } from '@efm/contracts';
import { LeagueError } from '../league.errors.js';

const ALLOWED_TRANSITIONS: Readonly<Record<LeagueSeasonStatus, readonly LeagueSeasonStatus[]>> = {
  DRAFT: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['ALLOCATION_REVIEW', 'CANCELLED'],
  ALLOCATION_REVIEW: ['READY', 'CANCELLED'],
  READY: ['ALLOCATION_REVIEW'],
  IN_PROGRESS: [],
  COMPLETED: [],
  CANCELLED: []
};

export function assertSeasonTransition(
  current: LeagueSeasonStatus,
  target: LeagueSeasonStatus
): void {
  if (!ALLOWED_TRANSITIONS[current].includes(target)) {
    throw new LeagueError(
      'INVALID_SEASON_TRANSITION',
      `Cannot transition league season from ${current} to ${target}`,
      409
    );
  }
}

export function isRegistrationMutable(status: LeagueSeasonStatus): boolean {
  return status === 'REGISTRATION_OPEN';
}
