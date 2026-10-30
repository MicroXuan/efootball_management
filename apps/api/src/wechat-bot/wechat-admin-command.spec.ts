import { parseAdminCommand } from './wechat-admin-command.js';
describe('administrator private management grammar', () => {
  it('uses explicit match side and distinct stable entity references', () => {
    expect(parseAdminCommand('晋级 M12 客队 原因：主队弃权')).toEqual({ kind: 'ADVANCE', reference: 12, side: 'AWAY', reason: '主队弃权' });
    expect(parseAdminCommand('转会 P3 T24 T41 500 原因：双方同意')).toEqual({ kind: 'TRANSFER', reference: 3, sourceTeam: 24, targetTeam: 41, amount: 500, reason: '双方同意' });
    expect(parseAdminCommand('调整成交 L8 T24 600 原因：核实报价')).toEqual({ kind: 'REVIEW', reference: 8, decision: 'ADJUST', team: 24, amount: 600, reason: '核实报价' });
  });
  it('requires reason for recovery, cancellation, transfer and adjudication', () => {
    for (const text of ['晋级 M12 主队', '转会 P3 T24 T41 -1 原因：a', '恢复拍卖 A3', '取消拍卖 A3', '转会 P3 T24 T41 1.5 原因：a']) expect(parseAdminCommand(text)).toBeNull();
    expect(parseAdminCommand('恢复拍卖 A3 原因：已核对群消息')).toMatchObject({ kind: 'RECOVER', reference: 3 });
    expect(parseAdminCommand('暂停拍卖 A3')).toMatchObject({ kind: 'PAUSE', reference: 3 });
  });
});
