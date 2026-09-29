import { Alert, Tabs } from 'antd';
import { Link, Outlet, useParams } from 'react-router-dom';
import { useAdminSession } from '../auth/admin-session';

export function LeagueShell() {
  const { leagueId = '' } = useParams();
  const { identity } = useAdminSession();
  const grant = identity?.leagueGrants.find((item) => item.leagueId === leagueId);
  if (!identity?.platformAdmin && !grant) return <Alert showIcon type="error" title="你没有此联赛的管理权限" />;
  return <div className="league-workspace">
    <div className="page-heading">
      <div><span className="section-kicker">LEAGUE WORKSPACE</span><h1>{grant?.leagueName ?? '联赛工作区'}</h1></div>
      <Tabs activeKey="teams" items={[{ key: 'teams', label: <Link to={`/leagues/${leagueId}/teams`}>用户与球队</Link> }]} />
    </div>
    <Outlet />
  </div>;
}
