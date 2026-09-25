import {
  NormalizedPlayerCardRecordSchema,
  type NormalizedPlayerCardRecord
} from '@efm/contracts';
import type { RawImportRow } from './import-adapter.js';

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function normalizeDisplayString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized === '' ? undefined : normalized;
}

function normalizeSkills(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const seen = new Set<string>();
  const skills: string[] = [];

  for (const entry of entries) {
    const display = normalizeDisplayString(entry);
    if (typeof display !== 'string') {
      continue;
    }

    const key = normalizeSearchText(display);
    if (!seen.has(key)) {
      seen.add(key);
      skills.push(display);
    }
  }

  return skills;
}

function normalizeAttributes(raw: RawImportRow): unknown {
  if (raw.attributes !== undefined && raw.attributes !== '') {
    return raw.attributes;
  }

  const attributesJson = normalizeDisplayString(raw.attributesJson);
  if (typeof attributesJson === 'string') {
    return JSON.parse(attributesJson) as unknown;
  }

  return {};
}

export function normalizeImportRow(raw: RawImportRow): NormalizedPlayerCardRecord {
  const normalizedStrings = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, normalizeDisplayString(value)])
  );
  const rating = normalizedStrings.overallRating;

  return NormalizedPlayerCardRecordSchema.parse({
    ...normalizedStrings,
    overallRating:
      typeof rating === 'number' ? rating : typeof rating === 'string' ? Number(rating) : rating,
    skills: normalizeSkills(raw.skills),
    attributes: normalizeAttributes(raw)
  });
}
