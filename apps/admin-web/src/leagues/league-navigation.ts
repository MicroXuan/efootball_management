export interface LeagueNavigationChild {
  key: string;
  label: string;
  path: string;
}

export interface LeagueNavigationItem extends LeagueNavigationChild {
  children?: LeagueNavigationChild[];
}

const routeGroups: Record<string, { topKey: string; childKey: string | null }> = {
  teams: { topKey: 'teams', childKey: null },
  seasons: { topKey: 'seasons', childKey: null },
  allocation: { topKey: 'allocation', childKey: null },
  cups: { topKey: 'cups', childKey: null },
  'transfer-windows': { topKey: 'windows', childKey: 'transfer-windows' },
  'valuation-windows': { topKey: 'windows', childKey: 'valuation-windows' },
  'nomination-windows': { topKey: 'windows', childKey: 'nomination-windows' },
  'forced-offer-windows': { topKey: 'windows', childKey: 'forced-offer-windows' },
  'season-calendar': { topKey: 'windows', childKey: 'season-calendar' },
  'player-market': { topKey: 'reviews', childKey: 'player-market' },
  'forced-player-market': { topKey: 'reviews', childKey: 'forced-player-market' },
  'valuation-reviews': { topKey: 'reviews', childKey: 'valuation-reviews' },
  'disappearance-requests': { topKey: 'reviews', childKey: 'disappearance-requests' },
  'transfer-proposals': { topKey: 'reviews', childKey: 'transfer-proposals' },
  'salary-rules': { topKey: 'salary-rules', childKey: null },
  ledger: { topKey: 'finance', childKey: null },
  auctions: { topKey: 'auctions', childKey: null },
  'wechat-bot': { topKey: 'more', childKey: 'wechat-bot' },
};

export function resolveLeagueNavigation(pathname: string): { topKey: string; childKey: string | null } {
  const segments = pathname.split('/').filter(Boolean);
  const route = segments[0] === 'leagues' && segments.length >= 3 ? segments[2] : '';
  return routeGroups[route] ?? { topKey: 'teams', childKey: null };
}

export function leagueNavigationItems(leagueId: string, includeWechatBot: boolean): LeagueNavigationItem[] {
  const root = `/leagues/${encodeURIComponent(leagueId)}`;
  const child = (key: string, label: string): LeagueNavigationChild => ({ key, label, path: `${root}/${key}` });
  return [
    child('teams', '球队管理'),
    child('seasons', '赛季管理'),
    child('allocation', '赛程管理'),
    child('cups', '杯赛中心'),
    { key: 'windows', label: '窗口设置', path: `${root}/transfer-windows`, children: [
      child('transfer-windows', '转会窗口'),
      child('valuation-windows', '身价窗口'),
      child('nomination-windows', '提名期'),
      child('forced-offer-windows', '强报期'),
      child('season-calendar', '赛季日历'),
    ] },
    { key: 'reviews', label: '审核模块', path: `${root}/player-market`, children: [
      child('player-market', '普通购买'),
      child('forced-player-market', '强报队列'),
      child('valuation-reviews', '身价审核'),
      child('disappearance-requests', '消失审核'),
      child('transfer-proposals', '协商转会'),
    ] },
    child('salary-rules', '工资规则'),
    { key: 'finance', label: '财务模块', path: `${root}/ledger` },
    child('auctions', '球员拍卖'),
    ...(includeWechatBot ? [{ key: 'more', label: '更多', path: `${root}/wechat-bot`, children: [child('wechat-bot', '微信群机器人')] }] : []),
  ];
}
