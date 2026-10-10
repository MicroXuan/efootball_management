import type { WechatBindingCodeResponse, WechatBindingStatus } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { wechatBotApi } from '../../services/wechat-bot'
import { bindingView } from './binding.viewmodel'

const EMPTY_STATUS: WechatBindingStatus = { status: 'UNBOUND' }

function errorCopy(error: unknown): string {
  return error instanceof ApiError ? error.message : '操作失败，请检查网络后重试'
}

Page({
  countdownTimer: undefined as ReturnType<typeof setInterval> | undefined,
  currentStatus: EMPTY_STATUS as WechatBindingStatus,
  issuedCode: undefined as WechatBindingCodeResponse | undefined,

  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    view: bindingView({ status: EMPTY_STATUS, now: Date.now() }),
  },

  onLoad() {
    void this.loadStatus()
  },

  onUnload() {
    this.stopCountdown()
  },

  async loadStatus() {
    this.setData({ state: 'loading' })
    try {
      this.currentStatus = await wechatBotApi.status()
      this.issuedCode = undefined
      this.render()
      this.setData({ state: 'loaded' })
    } catch (error) {
      this.setData({
        state: 'error',
        view: bindingView({ status: this.currentStatus, now: Date.now(), errorMessage: errorCopy(error) }),
      })
    }
  },

  async issueCode() {
    if (this.data.view.generateDisabled) return
    this.render(true)
    try {
      this.issuedCode = await wechatBotApi.issueCode()
      this.render()
      this.startCountdown()
    } catch (error) {
      this.render(false, errorCopy(error))
    }
  },

  copyInstruction() {
    const instruction = this.data.view.instruction
    if (instruction) wx.setClipboardData({ data: instruction })
  },

  async unbind() {
    const confirmed = await new Promise<boolean>((resolve) => wx.showModal({
      title: '解除机器人绑定？',
      content: '解除后，“我的赛程”等个人命令需要重新绑定才能使用。',
      confirmText: '确认解绑',
      success: ({ confirm }) => resolve(confirm),
      fail: () => resolve(false),
    }))
    if (!confirmed) return
    try {
      this.currentStatus = await wechatBotApi.unbind()
      this.issuedCode = undefined
      this.stopCountdown()
      this.render()
      wx.showToast({ title: '已解除绑定', icon: 'success' })
    } catch (error) {
      this.render(false, errorCopy(error))
    }
  },

  render(requesting = false, errorMessage = '') {
    this.setData({
      view: bindingView({
        status: this.currentStatus,
        ...(this.issuedCode ? { issuedCode: this.issuedCode } : {}),
        now: Date.now(),
        requesting,
        errorMessage,
      }),
    })
  },

  startCountdown() {
    this.stopCountdown()
    this.countdownTimer = setInterval(() => {
      this.render()
      if (this.data.view.codeExpired) this.stopCountdown()
    }, 1000)
  },

  stopCountdown() {
    if (this.countdownTimer !== undefined) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = undefined
    }
  },
})
