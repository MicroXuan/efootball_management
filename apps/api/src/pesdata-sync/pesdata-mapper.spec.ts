import fixture from './__fixtures__/bonucci-detail.json' with { type: 'json' };
import { normalizeImportRow } from '../player-import/record-normalizer.js';
import { PesdataPlayerDetailSchema } from './pesdata.schemas.js';
import {
  mapPesdataCardType,
  mapPesdataPlayer,
  pesdataValueChecksum
} from './pesdata-mapper.js';

describe('PESDATA player mapping', () => {
  const detail = PesdataPlayerDetailSchema.parse(fixture);

  it('maps a complete authorized detail into the import contract', () => {
    const row = mapPesdataPlayer(detail);

    expect(row).toMatchObject({
      externalId: '88045755859255',
      playerExternalId: '33079',
      playerNameZh: '莱昂纳多·博努奇',
      playerNameEn: 'Leonardo Bonucci',
      position: 'CB',
      overallRating: 87,
      cardType: 'EPIC',
      packExternalId: expect.any(String),
      packName: 'Epic Power Tackle',
      releaseDate: '2026-09-24',
      imageUrl: 'https://img.pesdata.net/images/playerCard/88045755859255_l.webp',
      sourceUpdatedAt: '2026-09-24T00:00:00.000Z',
      autoBuildAllocation: { defending: 12, aerialStrength: 8 },
      autoBuildMaxOverall: 98,
      dtRating: 97,
      algorithmVersion: 'pesdata-auto-v1'
    });
    const attributes = row.attributes as Record<string, unknown>;
    expect(attributes.speed).toBe(77);
    expect(attributes.acceleration).toBe(68);
    expect(attributes.finishing).toBe(63);
    expect(attributes.dribbling).toBe(65);
    expect(attributes.stamina).toBe(75);
    expect(attributes.goalkeeping).toBe(40);
    expect(attributes.foot).toBe('右脚');
    expect(attributes.height).toBe(190);
    expect(Array.isArray(attributes.positionHot)).toBe(true);
    expect((attributes.sourceMetadata as Record<string, unknown>).unknown_source_field).toBe(
      'fixture-preserved'
    );
    expect(row.skills).toHaveLength(10);
    expect(() => normalizeImportRow(row)).not.toThrow();
  });

  it('falls back to the small artwork only when PESDATA has no large card image', () => {
    expect(mapPesdataPlayer({ ...detail, player_big: undefined }).imageUrl).toBe(
      'https://img.pesdata.net/images/playerCard/88045755859255_.webp'
    );
  });

  it.each([
    [1, 'STANDARD'],
    [2, 'LEGENDARY'],
    [3, 'EPIC'],
    [4, 'BIG_TIME'],
    [5, 'TRENDING'],
    [6, 'FEATURED'],
    [7, 'HIGHLIGHT'],
    [8, 'SHOW_TIME'],
    [99, 'OTHER']
  ])('maps card type %s to %s', (source, expected) => {
    expect(mapPesdataCardType(source)).toBe(expected);
  });

  it('rejects missing required source data instead of fabricating defaults', () => {
    expect(() => mapPesdataPlayer({ ...detail, playerId: '' })).toThrow(
      expect.objectContaining({ code: 'PESDATA_MAPPING_ERROR' })
    );
    expect(() => mapPesdataPlayer({ ...detail, agentTitle: '' })).toThrow(
      expect.objectContaining({ code: 'PESDATA_MAPPING_ERROR' })
    );
  });

  it('leaves automatic build output unavailable when the source does not provide it', () => {
    const row = mapPesdataPlayer({
      ...detail,
      autoBuildAllocation: undefined,
      autoBuildMaxOverall: undefined,
      dtRating: undefined,
      algorithmVersion: undefined
    });

    expect(row.autoBuildAllocation).toBeUndefined();
    expect(row.autoBuildMaxOverall).toBeUndefined();
    expect(row.dtRating).toBeUndefined();
    expect(row.algorithmVersion).toBeUndefined();
  });

  it('produces stable checksums independent of object key order', () => {
    expect(pesdataValueChecksum({ a: 1, b: { c: 2 } })).toBe(
      pesdataValueChecksum({ b: { c: 2 }, a: 1 })
    );
  });
});
