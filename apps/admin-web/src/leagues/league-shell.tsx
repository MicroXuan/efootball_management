import { Alert, Tabs } from 'antd';
import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAdminSession } from '../auth/admin-session';

export function LeagueShell() {
  const { leagueId = '' } = useParams();
  const location = useLocation();
  const { identity } = useAdminSession();
  const grant = identity?.leagueGrants.find((item) => item.leagueId === leagueId);
  if (!identity?.platformAdmin && !grant) return <Alert showIcon type="error" title="你没有此联赛的管理权限" />;
  return <div className="league-workspace">
    <div className="page-heading">
      <div><span className="section-kicker">联赛工作区</span><h1>{grant?.leagueName ?? '联赛工作区'}</h1></div>
      <Tabs activeKey={location.pathname.includes('/seasons') ? 'seasons' : location.pathname.includes('/salary-rules') ? 'salary' : location.pathname.includes('/transfer-windows') ? 'windows' : location.pathname.includes('/ledger') ? 'ledger' : 'teams'} items={[
        { key: 'teams', label: <Link to={`/leagues/${leagueId}/teams`}>用户与球队</Link> },
        { key: 'seasons', label: <Link to={`/leagues/${leagueId}/seasons`}>赛季管理</Link> },
        { key: 'salary', label: <Link to={`/leagues/${leagueId}/salary-rules`}>工资规则</Link> },
        { key: 'windows', label: <Link to={`/leagues/${leagueId}/transfer-windows`}>转会窗口</Link> },
        { key: 'ledger', label: <Link to={`/leagues/${leagueId}/ledger`}>财务流水</Link> }
      ]} />
    </div>
    <Outlet />
  </div>;
}
