export type MissingDetailEvidence = 'FOUND' | 'CONFIRMED_ABSENT' | 'UNKNOWN';
export type MissingCardDecision = 'CONFLICT' | 'REMOVAL_CANDIDATE' | 'REMOVAL_CONFIRMED';

export function scheduledBusinessDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function classifyMissingCard(input: {
  today: string;
  previousTrustedDate: string | null;
  previousMissing: boolean;
  detail: MissingDetailEvidence;
}): MissingCardDecision {
  if (input.detail === 'FOUND') return 'CONFLICT';
  if (input.detail === 'CONFIRMED_ABSENT') return 'REMOVAL_CONFIRMED';
  if (!input.previousMissing || !input.previousTrustedDate) return 'REMOVAL_CANDIDATE';
  const previous = new Date(`${input.previousTrustedDate}T00:00:00.000Z`);
  if (Number.isNaN(previous.valueOf())) return 'REMOVAL_CANDIDATE';
  previous.setUTCDate(previous.getUTCDate() + 1);
  return previous.toISOString().slice(0, 10) === input.today
    ? 'REMOVAL_CONFIRMED' : 'REMOVAL_CANDIDATE';
}

export function inspectScanPage(input: {
  offset: number;
  limit: number;
  count: number;
  ids: string[];
}): string | null {
  const { offset, limit, count, ids } = input;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1
    || !Number.isSafeInteger(count) || count < 0 || offset > count) return 'INVALID_PAGE_METADATA';
  if (ids.some((id) => !id.trim())) return 'EMPTY_ID';
  if (new Set(ids).size !== ids.length) return 'DUPLICATE_ID';
  if (ids.length > limit || offset + ids.length > count) return 'INVALID_PAGE_LENGTH';
  if (ids.length !== Math.min(limit, count - offset)) return 'INCOMPLETE_PAGE';
  return null;
}
