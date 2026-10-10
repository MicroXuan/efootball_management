import type { WechatGroupCapabilityType } from '@efm/contracts';

export const WECHAT_MESSAGE_SAFE_LIMIT = 800;

export function paginateWechatMessage(
  heading: string,
  lines: string[],
  limit = WECHAT_MESSAGE_SAFE_LIMIT
): string[] {
  const normalized = [heading, ...lines].flatMap((line) => splitLongLine(line, limit));
  const pages: string[] = [];
  let current = '';
  for (const line of normalized) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) pages.push(current);
    current = line;
  }
  if (current) pages.push(current);
  return pages.length > 0 ? pages : [heading.slice(0, limit)];
}

function splitLongLine(line: string, limit: number): string[] {
  if (line.length <= limit) return [line];
  const chunks: string[] = [];
  for (let offset = 0; offset < line.length; offset += limit) {
    chunks.push(line.slice(offset, offset + limit));
  }
  return chunks;
}

export function formatWechatHelp(capabilities: readonly WechatGroupCapabilityType[]): string {
  const enabled = new Set(capabilities);
  if (enabled.size === 0) {
    return '本群暂未启用机器人功能。';
  }

  const lines = ['可用命令：'];
  if (enabled.has('SCHEDULE_QUERY')) {
    lines.push(
      '查询赛程：查看本群可查询的赛程',
      '我的赛程：查看自己球队的赛程'
    );
  }
  if (enabled.has('PLAYER_AUCTION')) {
    lines.push(
      '开始拍卖：开始待开拍的批次',
      '暂停拍卖：暂停当前拍卖',
      '继续拍卖：恢复暂停的拍卖',
      '取消拍卖：取消当前拍卖',
      '纯数字出价（例如 120）：对当前球员出价'
    );
  }
  lines.push('帮助：查看本群命令说明');
  if (enabled.has('SCHEDULE_QUERY')) {
    lines.push('', '首次使用“我的赛程”时，请先在小程序获取验证码，再私聊机器人发送：绑定 123456');
  }
  return lines.join('\n');
}
