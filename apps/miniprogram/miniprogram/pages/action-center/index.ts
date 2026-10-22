import type { ActionCenterResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { loadActionCenter, markActionCenterRead, readActionCenterVersions } from '../../services/action-center'
import { actionCenterView, type ActionCenterView } from './action-center.viewmodel'

type LoadOptions = { leagueId?: string }
type TaskTapEvent = { currentTarget: { dataset: { route?: string } } }

const emptyResponse: ActionCenterResponse = { items: [], actionRequiredCount: 0 }

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    leagueId: '',
    view: actionCenterView(emptyResponse, {}) as ActionCenterView,
  },

  onLoad(options: LoadOptions) {
    this.setData({ leagueId: options.leagueId ?? '' })
  },

  onShow() {
    void this.load(this.data.state !== 'loaded')
  },

  onPullDownRefresh() {
    void this.load(false).finally(() => wx.stopPullDownRefresh())
  },

  retry() {
    void this.load()
  },

  async load(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      const response = await loadActionCenter()
      const readVersions = readActionCenterVersions()
      const visibleItems = response.items.filter((item) => !this.data.leagueId || item.league.id === this.data.leagueId)
      this.setData({
        state: 'loaded',
        errorMessage: '',
        view: actionCenterView(response, readVersions, this.data.leagueId),
      })
      markActionCenterRead(visibleItems)
    } catch (error) {
      this.setData({
        state: !showLoading && this.data.state === 'loaded' ? 'loaded' : 'error',
        errorMessage: error instanceof ApiError ? error.message : '待办加载失败，请稍后重试',
      })
    }
  },

  openTask(event: TaskTapEvent) {
    const route = event.currentTarget.dataset.route
    if (route?.startsWith('/pages/')) wx.navigateTo({ url: route })
  },
})
