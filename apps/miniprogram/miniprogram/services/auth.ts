import type { AuthTokenResponse } from '@efm/contracts'
import { api } from './api'
import { session } from './session'

function wechatLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }) => code ? resolve(code) : reject(new Error('微信未返回登录凭证')),
      fail: () => reject(new Error('无法获取微信登录凭证')),
    })
  })
}

export const auth = {
  async login(): Promise<void> {
    const code = await wechatLogin()
    const tokens = await api.request<AuthTokenResponse>({
      path: '/auth/wechat',
      method: 'POST',
      data: { code },
      skipAuth: true,
    })
    session.setTokens(tokens)
  },
}
