import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league team detail template', () => {
  it('presents automatic-build overall without roster-facing DT', () => {
    const template = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8');

    expect(template).toContain('自动加点总评 {{item.maxOverall}}');
    expect(template).not.toContain('DT {{item.dtRating}}');
  });
});
