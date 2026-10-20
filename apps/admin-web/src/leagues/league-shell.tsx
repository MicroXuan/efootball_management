import { Alert, Tabs } from 'antd';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAdminSession } from '../auth/admin-session';
import { featureFlags } from '../config/features';
import { AdminIcon } from '../design-system/icons';
import { leagueNavigationItems, resolveLeagueNavigation } from './league-navigation';

const groupIcons = {
  teams: 'teams', seasons: 'seasons', allocation: 'allocation', cups: 'cup',
  windows: 'transfer', reviews: 'review', finance: 'finance', auctions: 'review', more: 'bot',
} as const;

export function LeagueShell() {
  const { leagueId = '' } = useParams();
  const location = useLocation();
  const { identity } = useAdminSession();
  const grant = identity?.leagueGrants.find((item) => item.leagueId === leagueId);
  if (!identity?.platformAdmin && !grant) return <Alert showIcon type="error" title="你没有此联赛的管理权限" />;

  const active = resolveLeagueNavigation(location.pathname);
  const items = leagueNavigationItems(leagueId, featureFlags.wechatBot);
  const selectedGroup = items.find(({ key }) => key === active.topKey);
  return <div className="league-workspace">
    <div className="page-heading">
      <div className="league-heading-copy"><span className="section-kicker">联赛工作区</span><h1>{grant?.leagueName ?? '联赛工作区'}</h1><p>管理球队、赛季、赛果与联赛规则。</p></div>
      <nav className="league-heading-nav" aria-label="联赛工作区导航">
        <Tabs activeKey={active.topKey} items={items.map((item) => ({
          key: item.key,
          label: <Link aria-current={active.topKey === item.key ? 'page' : undefined} to={item.path}>
            <AdminIcon name={groupIcons[item.key as keyof typeof groupIcons]} />{item.label}
          </Link>,
        }))} />
      </nav>
      {selectedGroup?.children && <nav className="league-group-nav" aria-label="联赛分组导航">
        {selectedGroup.children.map((child) => <Link
          key={child.key}
          aria-current={active.childKey === child.key ? 'page' : undefined}
          to={child.path}
        >{child.label}</Link>)}
      </nav>}
    </div>
    <Outlet />
  </div>;
}
