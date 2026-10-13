import { describe, expect, it } from 'vitest';
import { formatDateTime } from './date-time';

describe('formatDateTime', () => {
  it('formats ISO timestamps as Beijing time with Chinese date units and seconds', () => {
    expect(formatDateTime('2026-10-02T23:12:10.879Z')).toBe('2026年10月03日 07:12:10');
  });

  it('uses a placeholder for missing or invalid values', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});
