import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { session } from './session'

type ContainerOptions = { path: string; header: Record<string, string> }

describe('mini-program session and API client', () => {
  const storage = new Map<string, unknown>()
  const callContainer = vi.fn()

  beforeEach(() => {
    storage.clear()
    callContainer.mockReset()
    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: unknown) => storage.set(key, value)),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
      cloud: { callContainer },
      reLaunch: vi.fn(),
    } as unknown as WechatMiniprogram.Wx
  })

  it('keeps the current API environment session separate from legacy storage', () => {
    storage.set('efm.session.v1', {
      accessToken: 'other-environment-access',
      refreshToken: 'other-environment-refresh',
    })
    expect(session.getAccessToken()).toBeUndefined()

    session.setTokens({
      accessToken: 'access-1',
      expiresInSeconds: 900,
      refreshToken: 'refresh-1',
      refreshExpiresInSeconds: 2_592_000,
    })

    expect(session.getAccessToken()).toBe('access-1')
    expect(storage.get('efm.session.v1.cloud1-d0g1gwk2aefd9f1e8.efm-dev')).toMatchObject({ refreshToken: 'refresh-1' })
  })

  it('refreshes an invalid access token and retries the protected request', async () => {
    session.setTokens({
      accessToken: 'invalid-access',
      expiresInSeconds: 900,
      refreshToken: 'refresh-1',
      refreshExpiresInSeconds: 2_592_000,
    })
    callContainer.mockImplementation(async (options: ContainerOptions) => {
      if (options.path.endsWith('/auth/refresh')) return {
        statusCode: 200,
        data: {
          accessToken: 'new-access',
          expiresInSeconds: 900,
          refreshToken: 'refresh-2',
          refreshExpiresInSeconds: 2_592_000,
        },
      }
      return options.header.Authorization === 'Bearer invalid-access'
        ? { statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: 'Access token is invalid' } } }
        : options.header.Authorization === 'Bearer new-access'
          ? { statusCode: 200, data: { id: 'current-user' } }
          : { statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: 'Authentication is required' } } }
    })

    await expect(api.request<{ id: string }>({ path: '/me' })).resolves.toEqual({ id: 'current-user' })
    expect(session.getAccessToken()).toBe('new-access')
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })

  it('uses one refresh for concurrent expired requests and retries each once', async () => {
    session.setTokens({
      accessToken: 'expired-access',
      expiresInSeconds: 900,
      refreshToken: 'refresh-1',
      refreshExpiresInSeconds: 2_592_000,
    })
    let protectedCalls = 0
    let refreshCalls = 0
    callContainer.mockImplementation(async (options: ContainerOptions) => {
      if (options.path.endsWith('/auth/refresh')) {
        refreshCalls += 1
        return {
          statusCode: 200,
          data: {
            accessToken: 'new-access',
            expiresInSeconds: 900,
            refreshToken: 'refresh-2',
            refreshExpiresInSeconds: 2_592_000,
          },
        }
      }
      protectedCalls += 1
      const expired = protectedCalls <= 2
      return {
        statusCode: expired ? 401 : 200,
        data: expired
          ? { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired', requestId: 'r1' } }
          : { ok: true },
      }
    })

    const [first, second] = await Promise.all([
      api.request<{ ok: boolean }>({ path: '/me' }),
      api.request<{ ok: boolean }>({ path: '/me/game-accounts' }),
    ])

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(refreshCalls).toBe(1)
    expect(protectedCalls).toBe(4)
    expect(session.getAccessToken()).toBe('new-access')
  })

  it('clears the session and navigates to login when refresh fails', async () => {
    session.setTokens({
      accessToken: 'expired-access',
      expiresInSeconds: 900,
      refreshToken: 'refresh-1',
      refreshExpiresInSeconds: 2_592_000,
    })
    callContainer.mockImplementation(async (options: ContainerOptions) => {
      const isRefresh = options.path.endsWith('/auth/refresh')
      return {
        statusCode: 401,
        data: { error: { code: isRefresh ? 'AUTH_REFRESH_INVALID' : 'AUTH_TOKEN_EXPIRED', message: 'unauthorized', requestId: 'r2' } },
      }
    })

    await expect(api.request({ path: '/me' })).rejects.toBeInstanceOf(ApiError)
    expect(session.getAccessToken()).toBeUndefined()
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })

  it('clears an invalid session when its refresh token is also invalid', async () => {
    session.setTokens({
      accessToken: 'invalid-access',
      expiresInSeconds: 900,
      refreshToken: 'invalid-refresh',
      refreshExpiresInSeconds: 2_592_000,
    })
    callContainer.mockImplementation(async (options: ContainerOptions) => ({
      statusCode: 401,
      data: { error: { code: options.path.endsWith('/auth/refresh') ? 'AUTH_REFRESH_INVALID' : 'AUTH_REQUIRED', message: 'invalid' } },
    }))

    await expect(api.request({ path: '/me' })).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' })
    expect(session.getAccessToken()).toBeUndefined()
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })

  it('does not refresh a protected request without a stored access token', async () => {
    callContainer.mockResolvedValue({
      statusCode: 401,
      data: { error: { code: 'AUTH_REQUIRED', message: 'Authentication is required' } },
    })

    await expect(api.request({ path: '/me' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(callContainer).toHaveBeenCalledTimes(1)
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })

  it('does not refresh or redirect when a public request returns 401', async () => {
    callContainer.mockImplementation(async () => {
      return {
        statusCode: 401,
        data: { error: { code: 'AUTH_REQUIRED', message: 'unexpected auth', requestId: 'public-1' } },
      }
    })

    await expect(api.request({ path: '/players', skipAuth: true })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    })
    expect(callContainer).toHaveBeenCalledTimes(1)
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })
})
