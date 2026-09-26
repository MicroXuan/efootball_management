import type { NormalizedPlayerCardRecord } from '@efm/contracts';

export type FieldDiff = Record<string, { before: unknown; after: unknown }>;
export type CalculatedDiff = {
  type: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'INVALID';
  fields: FieldDiff;
  errors: Array<{ code: string; path: string; message: string }>;
};

const sourceOwnedFields = [
  'playerExternalId',
  'playerNameZh',
  'playerNameEn',
  'playerShortName',
  'nationality',
  'club',
  'cardName',
  'position',
  'overallRating',
  'cardType',
  'playStyle',
  'status',
  'imageUrl',
  'packExternalId',
  'packName',
  'season',
  'releaseDate',
  'skills',
  'attributes',
  'sourceUpdatedAt'
] as const satisfies ReadonlyArray<keyof NormalizedPlayerCardRecord>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    );
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }

  return value;
}

function equivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function calculateRecordDiff(
  existing: NormalizedPlayerCardRecord | null,
  incoming: NormalizedPlayerCardRecord
): CalculatedDiff {
  if (!existing) {
    return { type: 'CREATE', fields: {}, errors: [] };
  }

  const fields: FieldDiff = {};
  for (const field of sourceOwnedFields) {
    if (!equivalent(existing[field], incoming[field])) {
      fields[field] = { before: existing[field], after: incoming[field] };
    }
  }

  return {
    type: Object.keys(fields).length === 0 ? 'UNCHANGED' : 'UPDATE',
    fields,
    errors: []
  };
}
