import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminMeResponse } from '@efm/contracts';
import { ApiError, type AdminApi } from '../lib/api';
import { AdminSessionProvider, useAdminSession } from './admin-session';
import { LoginPage } from './login-page';
import { ProtectedRoute } from './protected-route';

const me: AdminMeResponse = {
  admin: {
    id: '11111111-1111-4111-8111-111111111111',
    username: 'manager01',
    displayName: '赛事管理员',
    status: 'ACTIVE',
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    version: 1,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z'
  },
  platformAdmin: true,
  leagueGrants: []
};

function api(overrides: Partial<AdminApi> = {}): AdminApi {
  return {
    restore: vi.fn().mockResolvedValue(null),
    login: vi.fn().mockResolvedValue(me),
    logout: vi.fn().mockResolvedValue(undefined),
    onSessionExpired: vi.fn().mockReturnValue(() => undefined),
    request: vi.fn(),
    ...overrides
  };
}

function LogoutButton() {
  const session = useAdminSession();
  return <button onClick={() => void session.logout()}>退出登录</button>;
}

function renderAuth(client: AdminApi, initial = '/login') {
  return render(
    <AdminSessionProvider api={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<><span>管理工作台</span><LogoutButton /></>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AdminSessionProvider>
  );
}

describe('administrator authentication shell', () => {
  it('redirects an unauthenticated protected route to login', async () => {
    renderAuth(api(), '/');
    expect(await screen.findByRole('heading', { name: '赛事管理后台' })).toBeInTheDocument();
  });

  it('logs in and returns to the protected workspace', async () => {
    const client = api();
    renderAuth(client);
    await userEvent.type(screen.getByLabelText('管理员账号'), 'manager01');
    await userEvent.type(screen.getByLabelText('密码'), 'password-123');
    await userEvent.click(screen.getByRole('button', { name: '登录后台' }));

    expect(await screen.findByText('管理工作台')).toBeInTheDocument();
    expect(client.login).toHaveBeenCalledWith({ username: 'manager01', password: 'password-123' });
  });

  it('shows the shared safe message used for invalid, disabled, and locked accounts', async () => {
    const leaked = 'refresh-secret-value';
    const client = api({
      login: vi.fn().mockRejectedValue(new ApiError({
        status: 401,
        code: 'ADMIN_CREDENTIALS_INVALID',
        requestId: 'req-login',
        serverMessage: leaked
      }))
    });
    renderAuth(client);
    fireEvent.change(screen.getByLabelText('管理员账号'), { target: { value: 'manager01' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录后台' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不正确');
    expect(screen.queryByText(leaked)).not.toBeInTheDocument();
  });

  it('does not let a delayed restore overwrite a successful manual login', async () => {
    let releaseRestore!: (identity: AdminMeResponse | null) => void;
    const restore = new Promise<AdminMeResponse | null>((resolve) => { releaseRestore = resolve; });
    const client = api({ restore: vi.fn().mockReturnValue(restore) });
    renderAuth(client);

    await userEvent.type(screen.getByLabelText('管理员账号'), 'manager01');
    await userEvent.type(screen.getByLabelText('密码'), 'password-123');
    await userEvent.click(screen.getByRole('button', { name: '登录后台' }));
    expect(await screen.findByText('管理工作台')).toBeInTheDocument();

    await act(async () => releaseRestore(null));
    expect(screen.getByText('管理工作台')).toBeInTheDocument();
  });

  it('leaves protected content when the API broadcasts session expiry', async () => {
    let expire!: () => void;
    const client = api({
      restore: vi.fn().mockResolvedValue(me),
      onSessionExpired: vi.fn((listener) => {
        expire = listener;
        return () => undefined;
      })
    });
    renderAuth(client, '/');
    expect(await screen.findByText('管理工作台')).toBeInTheDocument();

    act(() => expire());
    expect(await screen.findByRole('heading', { name: '赛事管理后台' })).toBeInTheDocument();
  });

  it('restores an existing session and logs out without leaving protected content visible', async () => {
    const client = api({ restore: vi.fn().mockResolvedValue(me) });
    renderAuth(client, '/');
    expect(await screen.findByText('管理工作台')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(client.logout).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: '赛事管理后台' })).toBeInTheDocument();
  });

  it('clears the local session even when server-side logout is unavailable', async () => {
    const client = api({
      restore: vi.fn().mockResolvedValue(me),
      logout: vi.fn().mockRejectedValue(new Error('offline'))
    });
    renderAuth(client, '/');
    expect(await screen.findByText('管理工作台')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '退出登录' }));

    expect(await screen.findByRole('heading', { name: '赛事管理后台' })).toBeInTheDocument();
  });
});
