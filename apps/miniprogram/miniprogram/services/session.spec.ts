import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { session } from './session'

type ContainerOptions = { path: string }

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

  it('persists access and refresh tokens under versioned keys', () => {
    session.setTokens({
      accessToken: 'access-1',
      expiresInSeconds: 900,
      refreshToken: 'refresh-1',
      refreshExpiresInSeconds: 2_592_000,
    })

    expect(session.getAccessToken()).toBe('access-1')
    expect(storage.get('efm.session.v1')).toMatchObject({ refreshToken: 'refresh-1' })
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
