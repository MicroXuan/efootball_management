import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminMeResponse } from '@efm/contracts';
import type { AdminApi } from '../lib/api';
import { AdminSessionProvider } from '../auth/admin-session';
import { ApplicationShell } from '../app';
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
    expect(screen.queryByRole('link', { name: '管理员账号' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '审计日志' })).not.toBeInTheDocument();
  });

  it('shows platform navigation to platform administrators', async () => {
    const identity: AdminMeResponse = { admin: baseAdmin, platformAdmin: true, leagueGrants: [] };
    render(<AdminSessionProvider api={api(identity)}><MemoryRouter initialEntries={['/platform/leagues']}><ApplicationShell /></MemoryRouter></AdminSessionProvider>);

    expect(await screen.findByRole('link', { name: '管理员账号' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '联赛管理' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '审计日志' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '联赛管理' })).toHaveAttribute('aria-current', 'page');
  });

  it('exposes the league workspace navigation and current section', async () => {
    const leagueId = '22222222-2222-4222-8222-222222222222';
    const identity: AdminMeResponse = {
      admin: baseAdmin,
      platformAdmin: false,
      leagueGrants: [{ leagueId, leagueName: 'CELL 联赛', role: 'LEAGUE_MANAGER' }],
    };
    render(
      <AdminSessionProvider api={api(identity)}>
        <MemoryRouter initialEntries={[`/leagues/${leagueId}/seasons`]}>
          <Routes><Route path="/leagues/:leagueId/*" element={<LeagueShell />} /></Routes>
        </MemoryRouter>
      </AdminSessionProvider>,
    );

    expect(await screen.findByRole('navigation', { name: '联赛工作区导航' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '赛季管理' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '财务与交易' })).toBeInTheDocument();
  });
});
