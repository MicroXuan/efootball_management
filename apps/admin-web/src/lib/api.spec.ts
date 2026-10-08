import { z } from 'zod';
import type { AdminAuthResponse } from '@efm/contracts';
import { AdminApiClient, ApiError } from './api';

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

const auth = (accessToken: string, refreshToken: string): AdminAuthResponse => ({
  accessToken,
  expiresInSeconds: 900,
  refreshToken,
  refreshExpiresInSeconds: 2_592_000,
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
  }
});

describe('AdminApiClient', () => {
  beforeEach(() => sessionStorage.clear());

  it('refreshes once after 401 and retries with the rotated in-memory access token', async () => {
    sessionStorage.setItem('efm.admin.refresh', 'r'.repeat(32));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok({ error: { code: 'ADMIN_ACCESS_TOKEN_EXPIRED', message: 'expired', requestId: 'req-1' } }, 401))
      .mockResolvedValueOnce(ok(auth('new-access', 'n'.repeat(32))))
      .mockResolvedValueOnce(ok({ ok: true }));
    const client = new AdminApiClient({ fetcher });
    client.accept(auth('old-access', 'r'.repeat(32)));

    await expect(client.request('/v1/private', { schema: z.object({ ok: z.literal(true) }) }))
      .resolves.toEqual({ ok: true });

    expect(fetcher).toHaveBeenNthCalledWith(1, '/v1/private', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer old-access' })
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/v1/admin/auth/refresh', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ refreshToken: 'r'.repeat(32) })
    }));
    expect(fetcher).toHaveBeenNthCalledWith(3, '/v1/private', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer new-access' })
    }));
    expect(fetcher.mock.calls.flatMap(([url]) => String(url))).not.toContain('old-access');
    expect(fetcher.mock.calls.flatMap(([url]) => String(url))).not.toContain('new-access');
  });

  it('uploads multipart files with authentication and lets the browser set the boundary', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ url: 'https://media.example/league.png' }));
    const client = new AdminApiClient({ fetcher });
    client.accept(auth('access-token', 'r'.repeat(32)));
    const file = new File(['png'], 'league.png', { type: 'image/png' });

    await client.upload('/v1/admin/uploads/league-images', file, z.object({ url: z.url() }));

    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer access-token' }));
    expect(init.headers).not.toEqual(expect.objectContaining({ 'Content-Type': expect.any(String) }));
  });

  it('omits the admin token when a public request explicitly skips authentication', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ ok: true }));
    const client = new AdminApiClient({ fetcher });
    client.accept(auth('admin-access-token', 'r'.repeat(32)));

    await client.request('/v1/leagues/league-1', {
      skipAuth: true,
      schema: z.object({ ok: z.literal(true) })
    });

    expect(fetcher).toHaveBeenCalledWith('/v1/leagues/league-1', expect.objectContaining({
      headers: expect.not.objectContaining({ Authorization: expect.any(String) })
    }));
  });

  it('returns a safe typed error without echoing server secrets', async () => {
    const secret = 'access-secret-that-must-not-render';
    const fetcher = vi.fn().mockResolvedValue(ok({
      error: { code: 'INTERNAL_ERROR', message: `failed with ${secret}`, requestId: 'req-safe' }
    }, 500));
    const client = new AdminApiClient({ fetcher });

    const error = await client.request('/v1/failure', { schema: z.object({ ok: z.boolean() }) })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR', requestId: 'req-safe', status: 500 });
    expect(String((error as Error).message)).not.toContain(secret);
  });

  it('uses one refresh request for concurrent 401 responses', async () => {
    sessionStorage.setItem('efm.admin.refresh', 'r'.repeat(32));
    let releaseRefresh!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/v1/admin/auth/refresh') return pendingRefresh;
      const privateCalls = fetcher.mock.calls.filter(([url]) => String(url) === '/v1/private').length;
      return Promise.resolve(privateCalls <= 2
        ? ok({ error: { code: 'ADMIN_ACCESS_TOKEN_EXPIRED' } }, 401)
        : ok({ ok: true }));
    });
    const client = new AdminApiClient({ fetcher });
    client.accept(auth('old-access', 'r'.repeat(32)));

    const first = client.request('/v1/private', { schema: z.object({ ok: z.literal(true) }) });
    const second = client.request('/v1/private', { schema: z.object({ ok: z.literal(true) }) });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    releaseRefresh(ok(auth('new-access', 'n'.repeat(32))));

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(fetcher.mock.calls.filter(([url]) => String(url) === '/v1/admin/auth/refresh')).toHaveLength(1);
  });

  it('does not revive a session when an earlier refresh resolves after logout', async () => {
    sessionStorage.setItem('efm.admin.refresh', 'r'.repeat(32));
    let releaseRefresh!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/v1/private') return Promise.resolve(ok({ error: { code: 'ADMIN_ACCESS_TOKEN_EXPIRED' } }, 401));
      if (path === '/v1/admin/auth/refresh') return pendingRefresh;
      if (path === '/v1/admin/auth/logout') return Promise.resolve(ok({ ok: true }));
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    const client = new AdminApiClient({ fetcher });
    client.accept(auth('old-access', 'r'.repeat(32)));

    const privateRequest = client.request('/v1/private', { schema: z.object({ ok: z.literal(true) }) });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await client.logout();
    releaseRefresh(ok(auth('revived-access', 'n'.repeat(32))));

    await expect(privateRequest).rejects.toMatchObject({ code: 'ADMIN_SESSION_EXPIRED' });
    expect(sessionStorage.getItem('efm.admin.refresh')).toBeNull();
  });

  it('clears the session and broadcasts expiry when refresh is rejected', async () => {
    sessionStorage.setItem('efm.admin.refresh', 'r'.repeat(32));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok({ error: { code: 'ADMIN_ACCESS_TOKEN_EXPIRED' } }, 401))
      .mockResolvedValueOnce(ok({ error: { code: 'ADMIN_REFRESH_TOKEN_INVALID' } }, 401))
      .mockResolvedValueOnce(ok({ ok: true }));
    const client = new AdminApiClient({ fetcher });
    client.accept(auth('old-access', 'r'.repeat(32)));
    const expired = vi.fn();
    client.onSessionExpired(expired);

    await expect(client.request('/v1/private', { schema: z.object({ ok: z.literal(true) }) }))
      .rejects.toMatchObject({ code: 'ADMIN_REFRESH_TOKEN_INVALID' });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('efm.admin.refresh')).toBeNull();

    await client.request('/v1/public', { schema: z.object({ ok: z.literal(true) }) });
    expect(fetcher).toHaveBeenNthCalledWith(3, '/v1/public', expect.objectContaining({
      headers: expect.not.objectContaining({ Authorization: expect.any(String) })
    }));
  });
});
