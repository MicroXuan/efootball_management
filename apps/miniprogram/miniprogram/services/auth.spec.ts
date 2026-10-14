import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthTokenResponse } from '@efm/contracts'
import { auth, resolveWechatLoginCode } from './auth'
import { api } from './api'
import { session } from './session'

describe('mini-program WeChat login', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers the real WeChat login code', () => {
    expect(resolveWechatLoginCode({ code: 'wx-code', errMsg: 'login:ok' }, 'test-code-local-user')).toBe('wx-code')
  })

  it('only accepts a fallback code when one is explicitly configured', () => {
    expect(resolveWechatLoginCode({ errMsg: 'login:ok' }, 'test-code-local-user')).toBe('test-code-local-user')
    expect(() => resolveWechatLoginCode({ errMsg: 'login:ok' })).toThrow('微信未返回登录凭证')
  })

  it('defers to the server-configured development identity when DevTools omits the code', async () => {
    const tokens: AuthTokenResponse = {
      accessToken: 'access',
      expiresInSeconds: 900,
      refreshToken: 'refresh',
      refreshExpiresInSeconds: 2_592_000,
    }
    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: vi.fn(({ success }: WechatMiniprogram.LoginOption) => {
        success?.({ errMsg: 'login:ok' } as WechatMiniprogram.LoginSuccessCallbackResult)
      }),
    } as unknown as WechatMiniprogram.Wx
    vi.spyOn(api, 'request').mockResolvedValue(tokens)
    vi.spyOn(session, 'setTokens').mockImplementation(() => undefined)

    await auth.login()

    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: '/auth/wechat',
      data: { code: 'devtools-code-unavailable' },
    }))
    expect(session.setTokens).toHaveBeenCalledWith(tokens)
  })
})
