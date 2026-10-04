import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AdminSessionProvider, useAdminSession } from './auth/admin-session';
import { ProtectedRoute } from './auth/protected-route';
import { adminApi } from './lib/api';
import { premiumAdminTheme } from './design-system/theme';

const LoginPage = lazy(() => import('./auth/login-page').then((module) => ({ default: module.LoginPage })));
const ApplicationShell = lazy(() => import('./application-shell').then((module) => ({ default: module.ApplicationShell })));
const AdminAccountsPage = lazy(() => import('./platform/admin-accounts-page').then((module) => ({ default: module.AdminAccountsPage })));
const AuditPage = lazy(() => import('./platform/audit-page').then((module) => ({ default: module.AuditPage })));
const LeaguesPage = lazy(() => import('./platform/leagues-page').then((module) => ({ default: module.LeaguesPage })));
const LeagueShell = lazy(() => import('./leagues/league-shell').then((module) => ({ default: module.LeagueShell })));
const TeamDetailPage = lazy(() => import('./leagues/team-detail-page').then((module) => ({ default: module.TeamDetailPage })));
const TeamsPage = lazy(() => import('./leagues/teams-page').then((module) => ({ default: module.TeamsPage })));
const SeasonsPage = lazy(() => import('./leagues/seasons-page').then((module) => ({ default: module.SeasonsPage })));
const AllocationPage = lazy(() => import('./leagues/allocation-page').then((module) => ({ default: module.AllocationPage })));
const CupsPage = lazy(() => import('./leagues/cups-page').then((module) => ({ default: module.CupsPage })));
const SalaryRulesPage = lazy(() => import('./leagues/salary-rules-page').then((module) => ({ default: module.SalaryRulesPage })));
const TransferWindowsPage = lazy(() => import('./leagues/transfer-windows-page').then((module) => ({ default: module.TransferWindowsPage })));
const RosterPage = lazy(() => import('./rosters/roster-page').then((module) => ({ default: module.RosterPage })));
const LedgerPage = lazy(() => import('./rosters/ledger-page').then((module) => ({ default: module.LedgerPage })));
const ValuationWindowsPage = lazy(() => import('./valuations/valuation-windows-page').then((module) => ({ default: module.ValuationWindowsPage })));
const ValuationReviewsPage = lazy(() => import('./valuations/valuation-reviews-page').then((module) => ({ default: module.ValuationReviewsPage })));

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
          <Route path="/login" element={deferred(<LoginPage />)} />
          <Route element={<ProtectedRoute />}><Route element={deferred(<ApplicationShell />)}>
            <Route index element={<DefaultRoute />} />
            <Route element={<PlatformRoute />}>
              <Route path="platform/leagues" element={deferred(<LeaguesPage api={adminApi} />)} />
              <Route path="platform/admins" element={deferred(<AdminAccountsPage api={adminApi} />)} />
              <Route path="platform/audit" element={deferred(<AuditPage api={adminApi} />)} />
            </Route>
            <Route path="leagues/:leagueId" element={deferred(<LeagueShell />)}>
              <Route path="teams" element={deferred(<TeamsPage api={adminApi} />)} />
              <Route path="seasons" element={deferred(<SeasonsPage api={adminApi} />)} />
              <Route path="allocation" element={deferred(<AllocationPage api={adminApi} />)} />
              <Route path="cups" element={deferred(<CupsPage api={adminApi} />)} />
              <Route path="teams/:teamId" element={deferred(<TeamDetailPage api={adminApi} />)} />
              <Route path="teams/:teamId/roster" element={deferred(<RosterPage api={adminApi} />)} />
              <Route path="salary-rules" element={deferred(<SalaryRulesPage api={adminApi} />)} />
              <Route path="transfer-windows" element={deferred(<TransferWindowsPage api={adminApi} />)} />
              <Route path="ledger" element={deferred(<LedgerPage api={adminApi} />)} />
              <Route path="valuation-windows" element={deferred(<ValuationWindowsPage api={adminApi} />)} />
              <Route path="valuation-reviews" element={deferred(<ValuationReviewsPage api={adminApi} />)} />
            </Route>
          </Route></Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></BrowserRouter>
      </AdminSessionProvider>
    </ConfigProvider>
  );
}
