export type AdminCommand =
  | { kind: 'ADVANCE'; reference: number; side: 'HOME' | 'AWAY'; reason: string }
  | { kind: 'TRANSFER'; reference: number; sourceTeam: number; targetTeam: number; amount: number; reason: string }
  | { kind: 'START' | 'PAUSE' | 'RESUME' | 'CANCEL' | 'RECOVER'; reference: number; reason: string }
  | { kind: 'REVIEW'; reference: number; decision: 'CONFIRM' | 'ADJUST' | 'VOID'; team?: number; amount?: number; reason: string };
export function parseAdminCommand(text: string): AdminCommand | null {
  let m = /^晋级\s+M([1-9]\d{0,8})\s+(主队|客队)\s+原因[:：]\s*(\S.{0,511})$/u.exec(text);
  if (m) return { kind: 'ADVANCE', reference: +m[1]!, side: m[2] === '主队' ? 'HOME' : 'AWAY', reason: m[3]!.trim() };
  m = /^转会\s+P([1-9]\d{0,8})\s+T([1-9]\d{0,8})\s+T([1-9]\d{0,8})\s+(\d{1,9})\s+原因[:：]\s*(\S.{0,511})$/u.exec(text);
  if (m) return { kind: 'TRANSFER', reference: +m[1]!, sourceTeam: +m[2]!, targetTeam: +m[3]!, amount: +m[4]!, reason: m[5]!.trim() };
  m = /^(开始|暂停|继续|取消|恢复)拍卖\s+A([1-9]\d{0,8})(?:\s+原因[:：]\s*(\S.{0,511}))?$/u.exec(text);
  if (m) {
    if (['取消', '恢复'].includes(m[1]!) && !m[3]) return null;
    return { kind: ({ 开始: 'START', 暂停: 'PAUSE', 继续: 'RESUME', 取消: 'CANCEL', 恢复: 'RECOVER' } as const)[m[1] as '开始'], reference: +m[2]!, reason: m[3]?.trim() ?? '管理员私聊操作' };
  }
  m = /^(审核|作废)成交\s+L([1-9]\d{0,8})(?:\s+原因[:：]\s*(\S.{0,511}))?$/u.exec(text);
  if (m) {
    if (m[1] === '作废' && !m[3]) return null;
    return { kind: 'REVIEW', reference: +m[2]!, decision: m[1] === '审核' ? 'CONFIRM' : 'VOID', reason: m[3]?.trim() ?? '管理员确认拍卖结果' };
  }
  m = /^调整成交\s+L([1-9]\d{0,8})\s+T([1-9]\d{0,8})\s+(\d{1,9})\s+原因[:：]\s*(\S.{0,511})$/u.exec(text);
  return m ? { kind: 'REVIEW', reference: +m[1]!, decision: 'ADJUST', team: +m[2]!, amount: +m[3]!, reason: m[4]!.trim() } : null;
}
