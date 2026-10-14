import type { AuthTokenResponse } from '@efm/contracts'
import { localWechatLoginCode } from '../config/api'
import { api } from './api'
import { session } from './session'

type WechatLoginResult = {
  code?: string
  errMsg?: string
}

export function resolveWechatLoginCode(result: WechatLoginResult, fallbackCode?: string): string {
  if (result.code) return result.code
  if (fallbackCode && result.errMsg === 'login:ok') return fallbackCode
  throw new Error('微信未返回登录凭证')
}

function wechatLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => {
        try {
          resolve(resolveWechatLoginCode(result, localWechatLoginCode))
        } catch (error) {
          reject(error)
        }
      },
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
