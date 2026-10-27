import { parseScoreCommand } from './wechat-private-score.service.js';
describe('private score commands', () => {
  it('parses explicit stable match reference and ordered scores with a reason', () => {
    expect(parseScoreCommand('报分 M12 2:1 原因：赛后核对')).toEqual({ reference: 12, homeScore: 2, awayScore: 1, reason: '赛后核对' });
  });
  it.each(['报分 2133 2 1', '报分 M12 100:1 原因：核对', '报分 M12 2:1', '报分 M0 2:1 原因：核对'])('rejects ambiguous or invalid command %s', (text) => {
    expect(parseScoreCommand(text)).toBeNull();
  });
});
