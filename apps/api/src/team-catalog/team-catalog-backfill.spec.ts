import { buildLegacyShellSeed } from './team-catalog-backfill.js';

describe('team catalog legacy backfill', () => {
  it('creates a distinct custom shell for every legacy league team', () => {
    const first = buildLegacyShellSeed({
      id: '11111111-1111-4111-8111-111111111111',
      name: '阿贾克斯',
      shortName: '阿贾克斯',
      logoUrl: null
    });
    const second = buildLegacyShellSeed({
      id: '22222222-2222-4222-8222-222222222222',
      name: '阿贾克斯',
      shortName: '阿贾克斯',
      logoUrl: 'https://media.example/ajax.webp'
    });

    expect(first).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      sourceType: 'CUSTOM',
      sourceExternalId: null,
      nameZh: '阿贾克斯',
      nameEn: null,
      nameJa: null,
      shortName: '阿贾克斯',
      storedLogoUrl: null,
      status: 'ACTIVE'
    });
    expect(second.id).not.toBe(first.id);
    expect(second.storedLogoUrl).toBe('https://media.example/ajax.webp');
  });
});
