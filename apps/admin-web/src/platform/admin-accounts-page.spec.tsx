import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { AdminAccountsPage } from './admin-accounts-page';

const account = {
  id: '11111111-1111-4111-8111-111111111111', username: 'manager01', displayName: '联赛管理员', status: 'ACTIVE',
  failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, version: 1,
  createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
};
const league = {
  id: '22222222-2222-4222-8222-222222222222', name: 'CELL 联赛', shortName: 'CELL', description: '', logoUrl: null,
  status: 'ACTIVE', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL', defaultSuperCapacity: 23,
  defaultChampionCapacity: 18, defaultPromotionCount: 4, featuredSeason: null, version: 1,
  createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z'
};
const grant = {
  id: '33333333-3333-4333-8333-333333333333', adminId: account.id, leagueId: league.id,
  leagueName: league.name, role: 'LEAGUE_MANAGER', grantedById: '55555555-5555-4555-8555-555555555555',
  createdAt: '2026-09-29T00:00:00.000Z', revokedAt: null, version: 1
};

it('loads accounts and protected leagues for account creation and grants', async () => {
  const request = vi.fn((path: string) => Promise.resolve(path === '/v1/admin/accounts'
    ? { items: [account] }
    : path.endsWith('/league-grants') ? { items: [] } : { items: [], nextCursor: null }));
  render(<AdminAccountsPage api={{ request } as unknown as AdminApi} />);

  expect(await screen.findByText('manager01')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '账号管理' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建管理员' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '添加授权' })).toBeInTheDocument();
  expect(request).toHaveBeenCalledWith('/v1/admin/platform/leagues', expect.any(Object));
});

it('shows all active grants and lets the platform administrator revoke one', async () => {
  const request = vi.fn((path: string, options?: { method?: string }) => {
    if (path === '/v1/admin/accounts') return Promise.resolve({ items: [account] });
    if (path === '/v1/admin/platform/leagues') return Promise.resolve({ items: [league], nextCursor: null });
    if (options?.method === 'DELETE') return Promise.resolve({ ...grant, revokedAt: '2026-09-29T01:00:00.000Z', version: 2 });
    return Promise.resolve({ items: [grant] });
  });
  render(<AdminAccountsPage api={{ request } as unknown as AdminApi} />);

  expect(await screen.findByText('CELL 联赛')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '撤销 CELL 联赛' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/accounts/${account.id}/league-grants/${grant.id}`,
    expect.objectContaining({ method: 'DELETE', body: { expectedVersion: 1 } })
  ));
});

it('refreshes the reset target version after a password conflict', async () => {
  const latest = { ...account, version: 2, displayName: '最新管理员' };
  let accountLoads = 0;
  const request = vi.fn((path: string, options?: { method?: string }) => {
    if (path === '/v1/admin/accounts' && !options?.method) {
      accountLoads += 1;
      return Promise.resolve({ items: accountLoads === 1 ? [account] : [latest] });
    }
    if (path === '/v1/admin/platform/leagues') return Promise.resolve({ items: [], nextCursor: null });
    if (path.endsWith('/league-grants')) return Promise.resolve({ items: [] });
    if (path.endsWith('/reset-password')) return Promise.reject(new ApiError({ status: 409, code: 'VERSION_CONFLICT' }));
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  render(<AdminAccountsPage api={{ request } as unknown as AdminApi} />);

  await userEvent.click(await screen.findByRole('button', { name: '重置密码' }));
  fireEvent.animationEnd(screen.getByRole('dialog'));
  await userEvent.type(screen.getByLabelText('新密码'), 'new-password');
  await userEvent.click(screen.getByRole('button', { name: '确认重置' }));

  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/accounts/${account.id}/reset-password`, expect.objectContaining({ method: 'POST' })
  ));
  expect(await screen.findByRole('alert')).toHaveTextContent('已加载最新账号版本');
  await waitFor(() => expect(screen.getByText('最新管理员')).toBeInTheDocument());
  expect(screen.getByText(/重置密码 · 最新管理员/)).toBeInTheDocument();
});
