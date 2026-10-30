import { normalizeWechatCommand, PRIVATE_COMMAND_CANDIDATE, commandHelp, confirmationInstructions, auctionNextStep, syntaxHint } from './wechat-command-ux.js';
import { parseScoreCommand } from './wechat-private-score.service.js';
import { parseAdminCommand } from './wechat-admin-command.js';

it.each([['查询赛程2', '赛程2'], ['阵容t1', '阵容 T1'], ['拍卖a5  2', '拍卖 A5  2'], ['转会 p1  t1 t2 50 原因：小写 p1 保留', '转会 P1 T1 T2 50 原因：小写 p1 保留']])('normalizes supported syntax %s', (input, expected) => {
  expect(normalizeWechatCommand(input)).toBe(expected);
});
it('uses group schedule alias without interpreting ordinary chat', () => {
  expect(normalizeWechatCommand('赛程', true)).toBe('查询赛程');
  expect(PRIVATE_COMMAND_CANDIDATE.test('今天聊天')).toBe(false);
  expect(PRIVATE_COMMAND_CANDIDATE.test('报分M1')).toBe(true);
  expect(syntaxHint('报分M1')).toContain('正确格式：报分');
});
it('supports first score without reason but still rejects missing reasons for management', () => {
  expect(parseScoreCommand('报分 M1 2:1')).toMatchObject({ reason: '' });
  expect(parseAdminCommand('转会 P1 T1 T2 50')).toBeNull();
  expect(parseAdminCommand('晋级 M1 主队')).toBeNull();
});
it('keeps help short and labels absolute Beijing deadline', () => {
  expect(commandHelp(true)).toContain('拍卖帮助');
  expect(commandHelp(false)).not.toContain('转会帮助');
  expect(confirmationInstructions(new Date('2026-10-30T12:00:00Z'), '123456ABCDEF')).toContain('20:00:00');
  expect(confirmationInstructions(new Date('2026-10-30T12:00:00Z'), '123456ABCDEF')).toContain('北京时间');
});
it('distinguishes ordinary pause from recovery', () => {
  expect(auctionNextStep('PAUSED', 'A5')).toContain('继续拍卖 A5');
  expect(auctionNextStep('RECOVERY_REQUIRED', 'A5')).toContain('先核对');
  expect(auctionNextStep('RECOVERY_REQUIRED', 'A5')).toContain('恢复拍卖 A5');
});
