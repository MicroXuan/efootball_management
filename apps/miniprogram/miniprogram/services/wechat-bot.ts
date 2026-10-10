import type { WechatBindingCodeResponse, WechatBindingStatus } from '@efm/contracts'
import { api } from './api'

export const wechatBotApi = {
  status() {
    return api.request<WechatBindingStatus>({ path: '/me/wechat-bot/binding' })
  },

  issueCode() {
    return api.request<WechatBindingCodeResponse>({
      path: '/me/wechat-bot/binding-code',
      method: 'POST',
    })
  },

  unbind() {
    return api.request<WechatBindingStatus>({
      path: '/me/wechat-bot/binding',
      method: 'DELETE',
    })
  },
}
