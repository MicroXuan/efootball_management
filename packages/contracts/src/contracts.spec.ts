import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GameAccountInputSchema,
  NormalizedPlayerCardRecordSchema,
  PlayerSearchQuerySchema,
  ResourceIdSchema,
  WechatLoginRequestSchema
} from './index.js';

describe('shared API contracts', () => {
  it('rejects an empty WeChat login code', () => {
    assert.throws(() => WechatLoginRequestSchema.parse({ code: ' ' }));
  });

  it('rejects an unsupported game platform', () => {
    assert.throws(() => GameAccountInputSchema.parse({
      platform: 'SWITCH',
      serverRegion: 'international',
      gamerTag: 'Player 1'
    }));
  });

  it('rejects gamer tags longer than 64 characters', () => {
    assert.throws(() => GameAccountInputSchema.parse({
      platform: 'MOBILE',
      serverRegion: 'international',
      gamerTag: 'a'.repeat(65)
    }));
  });

  it('rejects invalid resource identifiers', () => {
    assert.throws(() => ResourceIdSchema.parse('not-a-uuid'));
  });

  it('trims accepted player-facing values', () => {
    const parsed = GameAccountInputSchema.parse({
      platform: 'MOBILE',
      serverRegion: ' international ',
      gamerTag: '  Player 1  '
    });

    assert.equal(parsed.serverRegion, 'international');
    assert.equal(parsed.gamerTag, 'Player 1');
    assert.equal(parsed.isDefault, false);
  });

  it('applies catalog query defaults and bounds', () => {
    const query = PlayerSearchQuerySchema.parse({ keyword: '  亚马尔  ', minOverall: '90' });

    assert.deepEqual(query, { keyword: '亚马尔', minOverall: 90, limit: 20 });
    assert.throws(() => PlayerSearchQuerySchema.parse({ limit: 101 }));
  });

  it('rejects an import record without either player name', () => {
    assert.throws(() => NormalizedPlayerCardRecordSchema.parse({
      externalId: 'card-1',
      cardName: 'Featured',
      position: 'CF',
      overallRating: 95,
      cardType: 'FEATURED'
    }));
  });

  it('rejects non-https artwork and out-of-range ratings', () => {
    const base = {
      externalId: 'card-1',
      playerNameEn: 'Player',
      cardName: 'Featured',
      position: 'CF',
      cardType: 'FEATURED'
    };

    assert.throws(() => NormalizedPlayerCardRecordSchema.parse({ ...base, overallRating: 111 }));
    assert.throws(() => NormalizedPlayerCardRecordSchema.parse({
      ...base,
      overallRating: 95,
      imageUrl: 'http://example.com/card.png'
    }));
  });
});
