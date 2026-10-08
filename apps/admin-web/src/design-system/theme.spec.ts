import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminSemanticColors, premiumAdminTheme } from './theme';

describe('premium admin theme', () => {
  it('keeps navigation dark, data surfaces light, and accent usage restrained', () => {
    expect(adminSemanticColors).toEqual({
      sidebar: '#10171B',
      sidebarSelected: '#222D32',
      navText: '#D6DEE1',
      navMuted: '#8A989F',
      workspace: '#F2F5F7',
      surface: '#FFFFFF',
      text: '#182126',
      textSecondary: '#5E6A70',
      border: '#D8E0E4',
      accent: '#B6F13A',
      success: '#52720F',
    });
  });

  it('sets readable controls, layered radii, focus color, and the Chinese system stack', () => {
    expect(premiumAdminTheme.token).toMatchObject({
      colorPrimary: '#B6F13A',
      colorText: '#182126',
      colorTextSecondary: '#5E6A70',
      colorBgLayout: '#F2F5F7',
      colorBorder: '#D8E0E4',
      colorSuccess: '#52720F',
      controlHeight: 44,
      borderRadius: 12,
      fontFamily: expect.stringContaining('PingFang SC'),
    });
    expect(premiumAdminTheme.token?.colorPrimaryBorder).toBe('#93C52C');
    expect(premiumAdminTheme.components?.Card?.borderRadiusLG).toBe(14);
    expect(premiumAdminTheme.components?.Button?.borderRadius).toBe(10);
  });

  it('draws only one focus ring for an allow-clear input', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    expect(styles).toContain('.ant-input-affix-wrapper .ant-input:focus-visible');
  });

  it('does not apply the global control height twice inside an input wrapper', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    expect(styles).toMatch(/\.ant-input-affix-wrapper\s*>\s*\.ant-input\s*\{[^}]*min-height:\s*0/);
  });
});
