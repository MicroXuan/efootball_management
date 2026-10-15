export type ForcedApplicationSnapshot = {
  now: Date;
  windowEndsAt: Date;
  amountMinor: number;
  currentOfficialValueMinor: number;
  valuationVersionSnapshot: number | null;
  currentValuationVersion: number;
  ownershipIdSnapshot: string;
  ownershipVersionSnapshot: number;
  currentOwnershipId: string | null;
  currentOwnershipVersion: number | null;
  currentOwnershipStatus: string | null;
};

export type ForcedApplicationDecision = {
  status: 'PENDING' | 'REQUOTE_REQUIRED' | 'OWNERSHIP_CHANGED' | 'EXPIRED';
  reason: string | null;
};

export type ForcedQueueItem = { id: string; firstValidSubmittedAt: Date };

export function reconcileForcedApplication(input: ForcedApplicationSnapshot): ForcedApplicationDecision {
  if (input.now >= input.windowEndsAt) return { status: 'EXPIRED', reason: 'TRANSFER_WINDOW_CLOSED' };
  if (input.currentOwnershipStatus !== 'ACTIVE') {
    return { status: 'OWNERSHIP_CHANGED', reason: 'OWNERSHIP_NO_LONGER_ACTIVE' };
  }
  if (input.currentOwnershipId !== input.ownershipIdSnapshot) {
    return { status: 'OWNERSHIP_CHANGED', reason: 'OWNERSHIP_ID_CHANGED' };
  }
  if (input.currentOwnershipVersion !== input.ownershipVersionSnapshot) {
    return { status: 'OWNERSHIP_CHANGED', reason: 'OWNERSHIP_VERSION_CHANGED' };
  }
  if (input.amountMinor < input.currentOfficialValueMinor) {
    return { status: 'REQUOTE_REQUIRED', reason: 'OFFICIAL_VALUE_INCREASED' };
  }
  return { status: 'PENDING', reason: null };
}

export function sortForcedQueue<T extends ForcedQueueItem>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    left.firstValidSubmittedAt.getTime() - right.firstValidSubmittedAt.getTime()
      || left.id.localeCompare(right.id));
}

export function forcedTransferPosition<T extends ForcedQueueItem>(items: readonly T[], applicationId: string): number | null {
  const index = sortForcedQueue(items).findIndex(({ id }) => id === applicationId);
  return index === -1 ? null : index + 1;
}
