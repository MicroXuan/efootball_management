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

export const WECHAT_HELP_TEXT = [
  '可用命令：',
  '查询赛程：查看本群联赛赛程',
  '我的赛程：查看自己球队的赛程',
  '帮助：查看命令说明',
  '',
  '首次使用“我的赛程”时，请先在小程序获取验证码，再私聊机器人发送：绑定 123456'
].join('\n');
