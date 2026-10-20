import { nationalityLabelZh } from './nationality-label.js';

describe('nationalityLabelZh', () => {
  it('uses locale country names and football-specific aliases', () => {
    expect(nationalityLabelZh('Italy')).toBe('意大利');
    expect(nationalityLabelZh('Brazil')).toBe('巴西');
    expect(nationalityLabelZh('England')).toBe('英格兰');
    expect(nationalityLabelZh('Korea Republic')).toBe('韩国');
  });

  it('preserves unknown and already-Chinese values', () => {
    expect(nationalityLabelZh('测试国')).toBe('测试国');
    expect(nationalityLabelZh(null)).toBeNull();
  });
});
