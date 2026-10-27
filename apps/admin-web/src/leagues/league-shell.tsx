import { Alert, Tabs } from 'antd';
import { useLayoutEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAdminSession } from '../auth/admin-session';
import { AdminIcon } from '../design-system/icons';
import { leagueNavigationItems, resolveLeagueNavigation } from './league-navigation';

const groupIcons = {
  teams: 'teams', seasons: 'seasons', allocation: 'allocation', cups: 'cup',
  windows: 'transfer', reviews: 'review', 'salary-rules': 'salary', finance: 'finance', auctions: 'review', more: 'bot',
} as const;

export function LeagueShell() {
  const { leagueId = '' } = useParams();
  const location = useLocation();
  const { identity } = useAdminSession();
  const grant = identity?.leagueGrants.find((item) => item.leagueId === leagueId);
  const active = resolveLeagueNavigation(location.pathname);
  const items = leagueNavigationItems(leagueId, true);
  const selectedGroup = items.find(({ key }) => key === active.topKey);
  const groupNavRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const revealSelected = () => {
      const nav = groupNavRef.current;
      const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!nav || !selected) return;
      const navBounds = nav.getBoundingClientRect();
      const selectedBounds = selected.getBoundingClientRect();
      if (selectedBounds.left < navBounds.left) nav.scrollLeft += selectedBounds.left - navBounds.left - 8;
      else if (selectedBounds.right > navBounds.right) nav.scrollLeft += selectedBounds.right - navBounds.right + 8;
    };
    revealSelected();
    window.addEventListener('resize', revealSelected);
    return () => window.removeEventListener('resize', revealSelected);
  }, [location.pathname, identity]);
  if (!identity?.platformAdmin && !grant) return <Alert showIcon type="error" title="你没有此联赛的管理权限" />;
  return <div className="league-workspace">
    <div className="page-heading">
      <div className="league-heading-copy"><span className="section-kicker">联赛工作区</span><h1>{grant?.leagueName ?? '联赛工作区'}</h1><p>管理球队、赛季、赛果与联赛规则。</p></div>
      <nav className="league-heading-nav league-heading-nav--bounded" aria-label="联赛工作区导航">
        <Tabs activeKey={active.topKey} items={items.map((item) => ({
          key: item.key,
          label: <Link aria-current={active.topKey === item.key ? 'page' : undefined} to={item.path}>
            <AdminIcon name={groupIcons[item.key as keyof typeof groupIcons]} />{item.label}
          </Link>,
        }))} />
      </nav>
      {selectedGroup?.children && <nav ref={groupNavRef} className="league-group-nav league-group-nav--bounded" aria-label="联赛分组导航">
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
