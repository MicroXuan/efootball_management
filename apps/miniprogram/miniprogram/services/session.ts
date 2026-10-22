import type { AuthTokenResponse } from '@efm/contracts'
import { apiRuntimeConfig } from '../config/api'

const SESSION_KEY = apiRuntimeConfig.transport === 'cloudbase'
  ? `efm.session.v1.${apiRuntimeConfig.environmentId}.${apiRuntimeConfig.serviceName}`
  : `efm.session.v1.${apiRuntimeConfig.baseUrl}`

type StoredSession = AuthTokenResponse & {
  storedAt: number
}

export const session = {
  getAccessToken(): string | undefined {
    return this.getTokens()?.accessToken
  },

  getRefreshToken(): string | undefined {
    return this.getTokens()?.refreshToken
  },

  getTokens(): StoredSession | undefined {
    const value = wx.getStorageSync<StoredSession | undefined>(SESSION_KEY)
    return value && typeof value === 'object' ? value : undefined
  },

  setTokens(tokens: AuthTokenResponse): void {
    wx.setStorageSync(SESSION_KEY, { ...tokens, storedAt: Date.now() } satisfies StoredSession)
  },

  clear(): void {
    wx.removeStorageSync(SESSION_KEY)
  },
}
