import { describe, expect, it } from '@jest/globals';
import { buildPlayerCardSearchFields } from './player-card-search-fields.js';

describe('buildPlayerCardSearchFields', () => {
  it('normalizes each searchable field independently', () => {
    expect(buildPlayerCardSearchFields({
      cardName: '  Ｅｐｉｃ   Cafe\u0301  ',
      packNameZh: '  传奇   球员 ',
      packNameEn: '  Ｂｉｇ   Time '
    })).toEqual({
      normalizedCardName: 'epic café',
      normalizedPackNameZh: '传奇 球员',
      normalizedPackNameEn: 'big time'
    });
  });

  it('keeps absent pack names absent', () => {
    expect(buildPlayerCardSearchFields({ cardName: 'A', packNameZh: null, packNameEn: null }))
      .toEqual({ normalizedCardName: 'a', normalizedPackNameZh: null, normalizedPackNameEn: null });
  });
});
