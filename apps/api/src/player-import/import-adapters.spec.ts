import { CsvImportAdapter } from './csv-import.adapter.js';
import { JsonImportAdapter } from './json-import.adapter.js';
import { normalizeImportRow, normalizeSearchText } from './record-normalizer.js';

describe('player import adapters', () => {
  describe('JsonImportAdapter', () => {
    it('parses a top-level array and numbers rows from one', () => {
      const rows = new JsonImportAdapter().parse(
        JSON.stringify([
          { externalId: 'c1', playerNameEn: 'Lamine Yamal' },
          { externalId: 'c2', playerNameZh: '亚历克西斯' }
        ])
      );

      expect(rows).toEqual([
        { rowNumber: 1, value: { externalId: 'c1', playerNameEn: 'Lamine Yamal' } },
        { rowNumber: 2, value: { externalId: 'c2', playerNameZh: '亚历克西斯' } }
      ]);
    });

    it('rejects a top-level object', () => {
      expect(() => new JsonImportAdapter().parse('{"externalId":"c1"}')).toThrow(
        'JSON import must contain a top-level array'
      );
    });

    it('rejects non-object array entries', () => {
      expect(() => new JsonImportAdapter().parse('["c1"]')).toThrow(
        'JSON import row 1 must be an object'
      );
    });
  });

  describe('CsvImportAdapter', () => {
    it('handles BOM, CRLF, quoted commas, and reports source line numbers', () => {
      const csv =
        '\uFEFFexternalId,playerNameZh,playerNameEn,cardName,position,overallRating,cardType,skills\r\n' +
        'c1,亚马尔,"Lamine, Yamal",精选,RWF,97,FEATURED,"Double Touch,Gamesmanship"\r\n';

      const [row] = new CsvImportAdapter().parse(csv);

      expect(row?.rowNumber).toBe(2);
      expect(row?.value.playerNameEn).toBe('Lamine, Yamal');
      expect(normalizeImportRow(row!.value).skills).toEqual(['Double Touch', 'Gamesmanship']);
    });
  });

  describe('record normalization', () => {
    it('keeps display spelling while generating a normalized search value', () => {
      expect(normalizeSearchText('Ａｌｅｘｉｓ')).toBe('alexis');
      expect(
        normalizeImportRow({
          externalId: ' card-1 ',
          playerNameEn: ' Ａｌｅｘｉｓ ',
          playerNameZh: '',
          cardName: '  Featured   Card ',
          position: 'AMF',
          overallRating: '96',
          cardType: 'FEATURED',
          skills: 'Double Touch, double   touch,Gamesmanship',
          attributesJson: '{"speed":94,"passing":91}'
        })
      ).toEqual(
        expect.objectContaining({
          externalId: 'card-1',
          playerNameEn: 'Ａｌｅｘｉｓ',
          playerNameZh: undefined,
          cardName: 'Featured Card',
          overallRating: 96,
          skills: ['Double Touch', 'Gamesmanship'],
          attributes: { speed: 94, passing: 91 }
        })
      );
    });

    it('accepts object attributes and array skills from JSON', () => {
      const normalized = normalizeImportRow({
        externalId: 'card-2',
        playerNameZh: '亚马尔',
        cardName: '精选',
        position: 'RWF',
        overallRating: 97,
        cardType: 'FEATURED',
        skills: ['Double Touch', 'Gamesmanship'],
        attributes: { speed: 98 }
      });

      expect(normalized.attributes).toEqual({ speed: 98 });
      expect(normalized.skills).toEqual(['Double Touch', 'Gamesmanship']);
      expect(normalized.status).toBe('ACTIVE');
    });
  });
});
