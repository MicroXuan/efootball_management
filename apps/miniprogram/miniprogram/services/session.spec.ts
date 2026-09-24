import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { session } from './session'

type RequestOptions = WechatMiniprogram.RequestOption

describe('mini-program session and API client', () => {
  const storage = new Map<string, unknown>()

  beforeEach(() => {
    storage.clear()
    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: unknown) => storage.set(key, value)),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
      request: vi.fn(),
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
    vi.mocked(wx.request).mockImplementation(((options: RequestOptions) => {
      if (String(options.url).endsWith('/auth/refresh')) {
        refreshCalls += 1
        queueMicrotask(() => options.success?.({
          statusCode: 200,
          data: {
            accessToken: 'new-access',
            expiresInSeconds: 900,
            refreshToken: 'refresh-2',
            refreshExpiresInSeconds: 2_592_000,
          },
          header: {},
          cookies: [],
          errMsg: 'request:ok',
          profile: {} as WechatMiniprogram.RequestProfile,
        }))
      } else {
        protectedCalls += 1
        const expired = protectedCalls <= 2
        queueMicrotask(() => options.success?.({
          statusCode: expired ? 401 : 200,
          data: expired
            ? { error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired', requestId: 'r1' } }
            : { ok: true },
          header: {},
          cookies: [],
          errMsg: 'request:ok',
          profile: {} as WechatMiniprogram.RequestProfile,
        }))
      }
      return {} as WechatMiniprogram.RequestTask
    }) as typeof wx.request)

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
    vi.mocked(wx.request).mockImplementation(((options: RequestOptions) => {
      const isRefresh = String(options.url).endsWith('/auth/refresh')
      queueMicrotask(() => options.success?.({
        statusCode: 401,
        data: { error: { code: isRefresh ? 'AUTH_REFRESH_INVALID' : 'AUTH_TOKEN_EXPIRED', message: 'unauthorized', requestId: 'r2' } },
        header: {},
        cookies: [],
        errMsg: 'request:ok',
        profile: {} as WechatMiniprogram.RequestProfile,
      }))
      return {} as WechatMiniprogram.RequestTask
    }) as typeof wx.request)

    await expect(api.request({ path: '/me' })).rejects.toBeInstanceOf(ApiError)
    expect(session.getAccessToken()).toBeUndefined()
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })
})
