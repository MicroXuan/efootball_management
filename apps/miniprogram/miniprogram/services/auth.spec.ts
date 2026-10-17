import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('rejects login when cloud mode does not receive a WeChat code', async () => {
    ;(globalThis as typeof globalThis & { wx: WechatMiniprogram.Wx }).wx = {
      login: vi.fn(({ success }: WechatMiniprogram.LoginOption) => {
        success?.({ errMsg: 'login:ok' } as WechatMiniprogram.LoginSuccessCallbackResult)
      }),
    } as unknown as WechatMiniprogram.Wx
    const request = vi.spyOn(api, 'request')
    vi.spyOn(session, 'setTokens').mockImplementation(() => undefined)

    await expect(auth.login()).rejects.toThrow('微信未返回登录凭证')

    expect(request).not.toHaveBeenCalled()
    expect(session.setTokens).not.toHaveBeenCalled()
  })
})
