import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('administrator route boundary', () => {
  it('does not register the retired result-dispute route or page', () => {
    const source = readFileSync(resolve(__dirname, 'app.tsx'), 'utf8');
    expect(source).not.toContain('ResultDisputesPage');
    expect(source).not.toContain('path="result-disputes"');
  });
});
