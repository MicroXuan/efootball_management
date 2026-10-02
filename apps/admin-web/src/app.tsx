import { Button, ConfigProvider, Layout, Menu, Tag } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AdminSessionProvider, useAdminSession } from './auth/admin-session';
import { LoginPage } from './auth/login-page';
import { ProtectedRoute } from './auth/protected-route';
import { adminApi } from './lib/api';
import { premiumAdminTheme } from './design-system/theme';
import { AdminIcon } from './design-system/icons';

const AdminAccountsPage = lazy(() => import('./platform/admin-accounts-page').then((module) => ({ default: module.AdminAccountsPage })));
const AuditPage = lazy(() => import('./platform/audit-page').then((module) => ({ default: module.AuditPage })));
const LeaguesPage = lazy(() => import('./platform/leagues-page').then((module) => ({ default: module.LeaguesPage })));
const LeagueShell = lazy(() => import('./leagues/league-shell').then((module) => ({ default: module.LeagueShell })));
const TeamDetailPage = lazy(() => import('./leagues/team-detail-page').then((module) => ({ default: module.TeamDetailPage })));
const TeamsPage = lazy(() => import('./leagues/teams-page').then((module) => ({ default: module.TeamsPage })));
const SeasonsPage = lazy(() => import('./leagues/seasons-page').then((module) => ({ default: module.SeasonsPage })));
const SalaryRulesPage = lazy(() => import('./leagues/salary-rules-page').then((module) => ({ default: module.SalaryRulesPage })));
const TransferWindowsPage = lazy(() => import('./leagues/transfer-windows-page').then((module) => ({ default: module.TransferWindowsPage })));
const RosterPage = lazy(() => import('./rosters/roster-page').then((module) => ({ default: module.RosterPage })));
const LedgerPage = lazy(() => import('./rosters/ledger-page').then((module) => ({ default: module.LedgerPage })));

const { Header, Sider, Content } = Layout;

export function ApplicationShell() {
  const session = useAdminSession();
  const location = useLocation();
  const admin = session.identity?.admin;
  const platformItems = session.identity?.platformAdmin ? [
    { key: '/platform/leagues', icon: <AdminIcon name="league" />, label: <Link aria-current={location.pathname === '/platform/leagues' ? 'page' : undefined} to="/platform/leagues">联赛管理</Link> },
    { key: '/platform/admins', icon: <AdminIcon name="administrators" />, label: <Link aria-current={location.pathname === '/platform/admins' ? 'page' : undefined} to="/platform/admins">管理员账号</Link> },
    { key: '/platform/audit', icon: <AdminIcon name="audit" />, label: <Link aria-current={location.pathname === '/platform/audit' ? 'page' : undefined} to="/platform/audit">审计日志</Link> }
  ] : [];
  const leagueItems = (session.identity?.leagueGrants ?? []).map((grant) => ({
    key: `/leagues/${grant.leagueId}`,
    icon: <AdminIcon name="league" />,
    label: <Link aria-current={location.pathname.startsWith(`/leagues/${grant.leagueId}`) ? 'page' : undefined} to={`/leagues/${grant.leagueId}/teams`}>{grant.leagueName}</Link>
  }));
  const selectedKey = leagueItems.find((item) => location.pathname.startsWith(item.key))?.key ?? location.pathname;

  return (
    <Layout className="admin-shell">
      <Sider width={272} className="admin-sider">
        <div className="shell-brand"><span>球</span><strong>赛事控制台</strong></div>
        <nav aria-label="后台主导航"><Menu mode="inline" selectedKeys={[selectedKey]} items={[
          ...(platformItems.length ? [{ type: 'group' as const, label: '平台管理', children: platformItems }] : []),
          ...(leagueItems.length ? [{ type: 'group' as const, label: '我的联赛', children: leagueItems }] : [])
        ]} /></nav>
        <div className="shell-version">管理系统 · 0.2</div>
      </Sider>
      <Layout>
        <Header className="admin-header">
          <div><span className="section-kicker">赛事运营</span><strong>管理工作台</strong></div>
          <div className="admin-identity">
            <Tag color="green">{session.identity?.platformAdmin ? '平台管理员' : '联赛管理员'}</Tag>
            <span>{admin?.displayName}</span>
            <Button type="text" onClick={() => void session.logout()}>退出登录</Button>
          </div>
        </Header>
        <Content className="admin-content"><Outlet /></Content>
      </Layout>
    </Layout>
  );
}

function DefaultRoute() {
  const { identity } = useAdminSession();
  if (identity?.platformAdmin) return <Navigate to="/platform/leagues" replace />;
  const league = identity?.leagueGrants[0];
  if (league) return <Navigate to={`/leagues/${league.leagueId}/teams`} replace />;
  return <section className="empty-dashboard"><h1>尚未分配联赛</h1><p>请联系平台管理员添加联赛管理权限。</p></section>;
}

function PlatformRoute() {
  const { identity } = useAdminSession();
  return identity?.platformAdmin ? <Outlet /> : <Navigate to="/" replace />;
}

const deferred = (page: React.ReactNode) => <Suspense fallback={<div className="loading-block">正在加载页面…</div>}>{page}</Suspense>;

export function App() {
  return (
    <ConfigProvider locale={zhCN} theme={premiumAdminTheme}>
      <AdminSessionProvider>
        <BrowserRouter><Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}><Route element={<ApplicationShell />}>
            <Route index element={<DefaultRoute />} />
            <Route element={<PlatformRoute />}>
              <Route path="platform/leagues" element={deferred(<LeaguesPage api={adminApi} />)} />
              <Route path="platform/admins" element={deferred(<AdminAccountsPage api={adminApi} />)} />
              <Route path="platform/audit" element={deferred(<AuditPage api={adminApi} />)} />
            </Route>
            <Route path="leagues/:leagueId" element={deferred(<LeagueShell />)}>
              <Route path="teams" element={deferred(<TeamsPage api={adminApi} />)} />
              <Route path="seasons" element={deferred(<SeasonsPage api={adminApi} />)} />
              <Route path="teams/:teamId" element={deferred(<TeamDetailPage api={adminApi} />)} />
              <Route path="teams/:teamId/roster" element={deferred(<RosterPage api={adminApi} />)} />
              <Route path="salary-rules" element={deferred(<SalaryRulesPage api={adminApi} />)} />
              <Route path="transfer-windows" element={deferred(<TransferWindowsPage api={adminApi} />)} />
              <Route path="ledger" element={deferred(<LedgerPage api={adminApi} />)} />
            </Route>
          </Route></Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></BrowserRouter>
      </AdminSessionProvider>
    </ConfigProvider>
  );
}
