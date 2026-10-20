import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminMeResponse } from '@efm/contracts';
import type { AdminApi } from '../lib/api';
import { AdminSessionProvider } from '../auth/admin-session';
import { ApplicationShell } from '../application-shell';
import { LeagueShell } from './league-shell';

const baseAdmin: AdminMeResponse['admin'] = {
  id: '11111111-1111-4111-8111-111111111111', username: 'manager01', displayName: '赛事管理员',
  status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, version: 1,
  createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
};

const api = (identity: AdminMeResponse): AdminApi => ({
  restore: vi.fn().mockResolvedValue(identity), login: vi.fn(), logout: vi.fn(), request: vi.fn(),
  onSessionExpired: vi.fn().mockReturnValue(() => undefined)
});

describe('role-aware administration navigation', () => {
  const leagueId = '22222222-2222-4222-8222-222222222222';
  const leagueIdentity: AdminMeResponse = {
    admin: baseAdmin,
    platformAdmin: false,
    leagueGrants: [{ leagueId, leagueName: 'CELL 联赛', role: 'LEAGUE_MANAGER' }],
  };

  function renderLeague(path: string, identity = leagueIdentity) {
    return render(
      <AdminSessionProvider api={api(identity)}>
        <MemoryRouter initialEntries={[`/leagues/${leagueId}/${path}`]}>
          <Routes><Route path="/leagues/:leagueId/*" element={<LeagueShell />} /></Routes>
        </MemoryRouter>
      </AdminSessionProvider>,
    );
  }

  it('shows every granted league without platform-only navigation', async () => {
    const identity: AdminMeResponse = {
      admin: baseAdmin,
      platformAdmin: false,
      leagueGrants: [
        { leagueId: '22222222-2222-4222-8222-222222222222', leagueName: 'CELL 联赛', role: 'LEAGUE_MANAGER' },
        { leagueId: '33333333-3333-4333-8333-333333333333', leagueName: 'GOK 联赛', role: 'LEAGUE_MANAGER' }
      ]
    };
    render(<AdminSessionProvider api={api(identity)}><MemoryRouter><ApplicationShell /></MemoryRouter></AdminSessionProvider>);

    expect(await screen.findByRole('link', { name: 'CELL 联赛' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GOK 联赛' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '账号管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '审计日志' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '数据同步' })).not.toBeInTheDocument();
  });

  it('shows platform navigation to platform administrators', async () => {
    const identity: AdminMeResponse = { admin: baseAdmin, platformAdmin: true, leagueGrants: [] };
    render(<AdminSessionProvider api={api(identity)}><MemoryRouter initialEntries={['/platform/leagues']}><ApplicationShell /></MemoryRouter></AdminSessionProvider>);

    expect(await screen.findByRole('link', { name: '账号管理' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '联赛管理' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '审计日志' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '数据同步' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '群机器人' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '数据同步' }).closest('.ant-menu-item')?.querySelector('.admin-icon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '联赛管理' })).toHaveAttribute('aria-current', 'page');
  });

  it('exposes the league workspace navigation and current section', async () => {
    renderLeague('seasons');

    const navigation = await screen.findByRole('navigation', { name: '联赛工作区导航' });
    expect(navigation).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '微信群机器人' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '赛季管理' })).toHaveAttribute('aria-current', 'page');
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: '联赛分组导航' })).not.toBeInTheDocument();
    const title = screen.getByRole('heading', { name: 'CELL 联赛' });
    expect(title.closest('.league-heading-copy')).toBeInTheDocument();
    expect(title.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(navigation).toHaveClass('league-heading-nav');
    for (const name of [
      '用户与球队', '赛季管理', '分组与赛程', '杯赛中心', '窗口设置',
      '审核', '财务', '球员拍卖',
    ]) {
      expect(screen.getByRole('link', { name }).querySelector('.admin-icon')).toBeInTheDocument();
    }
  });

  it.each([
    ['valuation-windows', '窗口设置', '身价窗口'],
    ['disappearance-requests', '审核', '消失审核'],
    ['ledger', '财务', '财务与交易'],
    ['nomination-windows/w1/candidates', '窗口设置', '提名期'],
  ])('selects %s in the top and secondary navigation', async (path, topLabel, childLabel) => {
    renderLeague(path);
    const topNav = await screen.findByRole('navigation', { name: '联赛工作区导航' });
    const childNav = screen.getByRole('navigation', { name: '联赛分组导航' });
    expect(topNav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(childNav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole('link', { name: topLabel })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: childLabel })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps unauthorized league navigation inaccessible', async () => {
    renderLeague('teams', { ...leagueIdentity, leagueGrants: [] });
    expect(await screen.findByText('你没有此联赛的管理权限')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '联赛工作区导航' })).not.toBeInTheDocument();
  });
});
