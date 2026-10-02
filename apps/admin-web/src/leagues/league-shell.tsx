import { Alert, Tabs } from 'antd';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAdminSession } from '../auth/admin-session';
import { AdminIcon } from '../design-system/icons';

export function LeagueShell() {
  const { leagueId = '' } = useParams();
  const location = useLocation();
  const { identity } = useAdminSession();
  const grant = identity?.leagueGrants.find((item) => item.leagueId === leagueId);
  if (!identity?.platformAdmin && !grant) return <Alert showIcon type="error" title="你没有此联赛的管理权限" />;
  const activeKey = location.pathname.includes('/seasons') ? 'seasons' : location.pathname.includes('/salary-rules') ? 'salary' : location.pathname.includes('/transfer-windows') ? 'windows' : location.pathname.includes('/ledger') ? 'ledger' : 'teams';
  return <div className="league-workspace">
    <div className="page-heading">
      <div><span className="section-kicker">联赛工作区</span><h1>{grant?.leagueName ?? '联赛工作区'}</h1><p>管理球队、赛季、工资与转会规则。</p></div>
      <nav aria-label="联赛工作区导航"><Tabs activeKey={activeKey} items={[
        { key: 'teams', label: <Link aria-current={activeKey === 'teams' ? 'page' : undefined} to={`/leagues/${leagueId}/teams`}><AdminIcon name="teams" />用户与球队</Link> },
        { key: 'seasons', label: <Link aria-current={activeKey === 'seasons' ? 'page' : undefined} to={`/leagues/${leagueId}/seasons`}><AdminIcon name="seasons" />赛季管理</Link> },
        { key: 'salary', label: <Link aria-current={activeKey === 'salary' ? 'page' : undefined} to={`/leagues/${leagueId}/salary-rules`}>工资规则</Link> },
        { key: 'windows', label: <Link aria-current={activeKey === 'windows' ? 'page' : undefined} to={`/leagues/${leagueId}/transfer-windows`}>转会窗口</Link> },
        { key: 'ledger', label: <Link aria-current={activeKey === 'ledger' ? 'page' : undefined} to={`/leagues/${leagueId}/ledger`}>财务流水</Link> }
      ]} /></nav>
    </div>
    <Outlet />
  </div>;
}
