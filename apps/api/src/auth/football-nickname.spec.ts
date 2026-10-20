import { describe, expect, it } from '@jest/globals';
import {
  FOOTBALL_NICKNAME_STYLES,
  FOOTBALL_NICKNAME_TITLES,
  generateFootballNickname
} from './football-nickname.js';

describe('football nickname generator', () => {
  it('provides the approved 1,008 base combinations', () => {
    expect(FOOTBALL_NICKNAME_STYLES).toHaveLength(36);
    expect(FOOTBALL_NICKNAME_TITLES).toHaveLength(28);
    expect(new Set(FOOTBALL_NICKNAME_STYLES).size).toBe(36);
    expect(new Set(FOOTBALL_NICKNAME_TITLES).size).toBe(28);
  });

  it('uses the random source once and avoids repetitive pairs', () => {
    expect(generateFootballNickname(() => 0)).toBe('疾风前锋');
    expect(generateFootballNickname(() => 0.999999)).toBe('从容追梦者');
    const values = [28 / 36, 19 / 28];
    expect(generateFootballNickname(() => values.shift() ?? 0)).toBe('铁血屏障');
  });
});
