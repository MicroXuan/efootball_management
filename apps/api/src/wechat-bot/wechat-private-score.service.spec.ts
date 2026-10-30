import { parseSchedulePageCommand, parseScoreCommand } from './wechat-private-score.service.js';
describe('private score commands', () => {
  it('parses explicit stable match reference and ordered scores with a reason', () => {
    expect(parseScoreCommand('报分 M12 2:1 原因：赛后核对')).toEqual({ reference: 12, homeScore: 2, awayScore: 1, reason: '赛后核对' });
  });
  it.each(['报分 2133 2 1', '报分 M12 100:1 原因：核对', '报分 M0 2:1 原因：核对'])('rejects ambiguous or invalid command %s', (text) => {
    expect(parseScoreCommand(text)).toBeNull();
  });
});

describe('private schedule page command', () => {
  it.each([['赛程', 1], ['赛程2', 2], ['赛程 2', 2], ['赛程  2', 2]])('accepts %s as page %i', (text, page) => {
    expect(parseSchedulePageCommand(text)).toBe(page);
  });
  it.each(['赛程0', '赛程 0', '赛程abc', '赛程2a'])('rejects invalid page %s', (text) => {
    expect(parseSchedulePageCommand(text)).toBeNull();
  });
});
