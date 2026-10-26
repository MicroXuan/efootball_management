import type { WechatBindingStatus } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { wechatBotApi } from '../../services/wechat-bot'
import { bindingView } from './binding.viewmodel'

const EMPTY_STATUS: WechatBindingStatus = { status: 'UNBOUND' }
const errorCopy = (error: unknown) => error instanceof ApiError ? error.message : '操作失败，请检查网络后重试'

Page({
  currentStatus: EMPTY_STATUS as WechatBindingStatus,
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    busy: false,
    view: bindingView({ status: EMPTY_STATUS }),
  },
  onLoad() { void this.loadStatus() },
  async loadStatus() {
    if (this.data.busy) return
    this.setData({ state: 'loading' })
    try {
      this.currentStatus = await wechatBotApi.status()
      this.setData({ state: 'loaded', view: bindingView({ status: this.currentStatus }) })
    } catch (error) {
      this.setData({ state: 'error', view: bindingView({ status: this.currentStatus, errorMessage: errorCopy(error) }) })
    }
  },
  async unbind() {
    if (this.data.busy || !this.data.view.showUnbind) return
    this.setData({ busy: true })
    const confirmed = await new Promise<boolean>((resolve) => wx.showModal({
      title: '解除机器人关联？',
      content: '解除后个人赛程查询和群内竞价将不可用，需要管理员在后台重新关联。',
      confirmText: '确认解除', success: ({ confirm }) => resolve(confirm), fail: () => resolve(false),
    }))
    if (!confirmed) { this.setData({ busy: false }); return }
    try {
      this.currentStatus = await wechatBotApi.unbind()
      this.setData({ view: bindingView({ status: this.currentStatus }) })
      wx.showToast({ title: '已解除关联', icon: 'success' })
    } catch (error) {
      this.setData({ view: bindingView({ status: this.currentStatus, errorMessage: errorCopy(error) }) })
    } finally { this.setData({ busy: false }) }
  },
})
