import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('league team detail template', () => {
  it('keeps the directory and action cards as separate shrinkable view controls', () => {
    const template = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8');
    const styles = readFileSync(resolve(__dirname, 'index.wxss'), 'utf8');

    expect(template).toContain('class="directory-link" role="button"');
    expect(template).toContain('class="workspace-link {{item.enabled');
    expect(template).toContain('aria-disabled="{{!item.enabled}}"');
    expect(template).not.toContain('<button');
    expect(styles).toMatch(/\.workspace-link\s*\{[^}]*min-width:\s*0/);
    expect(styles).toMatch(/\.workspace-link__copy\s*\{[^}]*min-width:\s*0/);
  });

  it('presents the compact player profile without card or transfer-window details', () => {
    const template = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8');

    expect(template).toContain('position-badge--{{item.positionTone}}');
    expect(template).toContain('{{item.heightCopy}}');
    expect(template).toContain('位置 {{item.positionCopy}}');
    expect(template).toContain('工资 {{item.salaryCopy}}');
    expect(template).not.toContain('{{item.cardName}}');
    expect(template).not.toContain('{{item.maxOverall}}');
    expect(template).not.toContain('当前转会窗口');
  });
});
