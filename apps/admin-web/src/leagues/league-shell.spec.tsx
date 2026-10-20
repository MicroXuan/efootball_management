import { fireEvent, render, screen } from '@testing-library/react';
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
      '球队管理', '赛季管理', '赛程管理', '杯赛中心', '窗口设置',
      '审核模块', '工资规则', '财务模块', '球员拍卖',
    ]) {
      expect(screen.getByRole('link', { name }).querySelector('.admin-icon')).toBeInTheDocument();
    }
  });

  it.each([
    ['salary-rules', '工资规则', '/salary-rules'],
    ['ledger', '财务模块', '/ledger'],
  ])('opens %s as a top-level tab without secondary navigation', async (path, label, suffix) => {
    renderLeague(path);
    const topNav = await screen.findByRole('navigation', { name: '联赛工作区导航' });
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', `/leagues/${leagueId}${suffix}`);
    expect(topNav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: '联赛分组导航' })).not.toBeInTheDocument();
  });

  it.each([
    ['valuation-windows', '窗口设置', '身价窗口'],
    ['disappearance-requests', '审核模块', '消失审核'],
    ['player-market', '审核模块', '普通购买'],
    ['forced-player-market', '审核模块', '强报队列'],
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

  it('keeps the last top entry and selected secondary entry in bounded scroll areas', async () => {
    renderLeague('transfer-proposals');
    const topNav = await screen.findByRole('navigation', { name: '联赛工作区导航' });
    const childNav = screen.getByRole('navigation', { name: '联赛分组导航' });
    expect(topNav).toHaveClass('league-heading-nav--bounded');
    expect(childNav).toHaveClass('league-group-nav--bounded');
    expect(topNav.querySelector('a[href$="/auctions"]')).toBeInTheDocument();
    expect(childNav.querySelector('a[href$="/transfer-proposals"]')).toHaveAttribute('aria-current', 'page');
  });

  it('scrolls a selected secondary link into view when its group is wider than the screen', async () => {
    const bounds = (left: number, right: number) => ({ left, right, width: right - left, top: 0, bottom: 34, height: 34, x: left, y: 0, toJSON: () => undefined });
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('league-group-nav')) return bounds(0, 160);
      if (this.getAttribute('aria-current') === 'page' && this.closest('.league-group-nav')) return bounds(246, 322);
      return bounds(0, 0);
    });
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('league-group-nav') ? 160 : 0;
    });
    try {
      renderLeague('transfer-proposals');
      const childNav = await screen.findByRole('navigation', { name: '联赛分组导航' });
      expect(childNav.scrollLeft).toBeGreaterThan(0);
      childNav.scrollLeft = 0;
      fireEvent(window, new Event('resize'));
      expect(childNav.scrollLeft).toBeGreaterThan(0);
    } finally {
      rectSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });

  it('keeps unauthorized league navigation inaccessible', async () => {
    renderLeague('teams', { ...leagueIdentity, leagueGrants: [] });
    expect(await screen.findByText('你没有此联赛的管理权限')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '联赛工作区导航' })).not.toBeInTheDocument();
  });
});
