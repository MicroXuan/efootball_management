/** Normalize syntax only; never infer a target or alter a free-text name/reason. */
export function normalizeWechatCommand(input: string, group = false): string {
  let text = input.trim();
  text = text.replace(/^查询赛程(?=\s|\d|$)/, '赛程');
  if (group && text === '赛程') return '查询赛程';
  text = text.replace(/^(阵容|拍卖)\s*([ta])([1-9]\d*)(?=\s|$)/i, (_, verb, prefix, n) => `${verb} ${prefix.toUpperCase()}${n}`);
  if (/^(报分|晋级|转会|开始拍卖|暂停拍卖|继续拍卖|取消拍卖|恢复拍卖|审核成交|调整成交|作废成交)\s/.test(text)) {
    const reasonAt = text.search(/\s+原因[:：]/);
    const args = reasonAt < 0 ? text : text.slice(0, reasonAt);
    text = args.replace(/\s+([mtpal])([1-9]\d*)(?=\s|$)/gi, (_, prefix, n) => ` ${prefix.toUpperCase()}${n}`) + (reasonAt < 0 ? '' : text.slice(reasonAt));
  }
  return text;
}
export const PRIVATE_COMMAND_CANDIDATE = /^(?:绑定\s+\d{6}|帮助|录分帮助|转会帮助|拍卖帮助|当前设置|联赛|赛季|球队|拍卖列表|(?:赛程|阵容|拍卖|切换联赛|切换赛季|报分|晋级|转会|开始拍卖|暂停拍卖|继续拍卖|取消拍卖|恢复拍卖|审核成交|调整成交|作废成交|确认|取消|操作)(?:\s.*|[A-Za-z0-9].*)?)$/u;
export const GROUP_COMMAND_CANDIDATE = /^(?:帮助|查询赛程|我的赛程|开始拍卖|暂停拍卖|继续拍卖|取消拍卖|\d+|赛程(?:\s*\d+)?)$/;
export const SCORE_HELP = '录分帮助\n赛程 / 赛程2\n报分 M编号 主队比分:客队比分\n首次录分可省略原因；更正已有赛果须加 原因：说明。\n晋级 M编号 主队/客队 原因：说明\n\n确认 确认码 / 取消 确认码 / 操作 确认码\n取消只放弃未提交预览，不能撤销已完成操作。';
export const TRANSFER_HELP = '转会帮助\n球队\n阵容 T编号\n转会 P编号 T转出 T转入 金额 原因：说明\n例如：转会 P1 T1 T2 50 原因：双方确认\n金额单位：资金，与后台一致，不作换算。\n先核对预览，再发送确认码。';
export function commandHelp(management: boolean): string {
  return '常用命令\n当前设置\n联赛 / 切换联赛 名称或ID\n赛季 / 切换赛季 名称或ID\n赛程 / 赛程2\n\n分类说明\n录分帮助' + (management ? '\n转会帮助\n拍卖帮助\n\n球队 / 阵容 T编号\n拍卖列表' : '') + '\n\n修改先预览，按北京时间截止时刻确认。取消不能撤销已完成操作。';
}
export function confirmationInstructions(expiresAt: Date, code: string): string {
  const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(expiresAt);
  return `确认截止：${time}（北京时间）\n有效期从预览生成起2分钟，消息传输耗时包含在内。\n确认 ${code}\n放弃：取消 ${code}`;
}
export function syntaxHint(text: string): string {
  const formats: [string, string][] = [
    ['报分', '报分 M编号 主队比分:客队比分 原因：说明'], ['晋级', '晋级 M编号 主队/客队 原因：说明'],
    ['转会', '转会 P编号 T转出 T转入 金额 原因：说明'], ['阵容', '阵容 T编号'], ['赛程', '赛程 2'],
    ['调整成交', '调整成交 L编号 T球队编号 金额 原因：说明'], ['作废成交', '作废成交 L编号 原因：说明'],
    ['审核成交', '审核成交 L编号'], ['恢复拍卖', '恢复拍卖 A编号 原因：核对说明'], ['取消拍卖', '取消拍卖 A编号 原因：说明'],
    ['开始拍卖', '开始拍卖 A编号'], ['暂停拍卖', '暂停拍卖 A编号'], ['继续拍卖', '继续拍卖 A编号'],
    ['拍卖', '拍卖 A编号 [页码]'], ['确认', '确认 12位确认码'], ['取消', '取消 12位确认码'], ['操作', '操作 12位确认码']
  ];
  return `命令格式不正确。\n正确格式：${formats.find(([prefix]) => text.startsWith(prefix))?.[1] ?? '发送“帮助”查看可用命令'}\n请将编号等占位文字替换为查询结果中的实际值。`;
}
export function auctionNextStep(status: string, ref: string): string {
  if (status === 'READY') return `下一步：开始拍卖 ${ref}`;
  if (status === 'ACTIVE') return `需要立即暂停：暂停拍卖 ${ref}`;
  if (status === 'PAUSED') return `下一步：继续拍卖 ${ref}（保留剩余时间）`;
  if (status === 'RECOVERY_REQUIRED') return `先核对群消息和异常发送任务，再发送：恢复拍卖 ${ref} 原因：核对说明（重新倒计时30秒）`;
  if (status === 'COMPLETED' || status === 'CANCELLED') return '拍卖已结束，请核对仍待审核的拍品。';
  return '请先在后台准备拍卖。';
}
