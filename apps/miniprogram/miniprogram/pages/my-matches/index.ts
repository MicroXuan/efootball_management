import type { MyMatchResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { competitionErrorMessage, formatLocalDate } from '../competitions/competitions.viewmodel'
import { primaryAction } from './matches.viewmodel'

Page({
  data: { loading: true, errorMessage: '', items: [] as Array<MyMatchResponse & { matchId: string; actionLabel: string; actionEnabled: boolean; plannedLabel: string }> },
  onLoad() { void this.load() },
  onShow() { if (!this.data.loading) void this.load(false) },
  onPullDownRefresh() { void this.load(false).finally(() => wx.stopPullDownRefresh()) },
  retry() { void this.load() },
  openMatch(event: { currentTarget: { dataset: { id?: string; enabled?: boolean } } }) {
    if (event.currentTarget.dataset.id && event.currentTarget.dataset.enabled) {
      wx.navigateTo({ url: `/pages/match-result/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` })
    }
  },
  async load(showLoading = true) {
    if (showLoading) this.setData({ loading: true, errorMessage: '' })
    try {
      const response = await competitionsApi.myMatches(undefined, 100)
      this.setData({ items: response.items.map((item) => {
        const action = primaryAction(item.action)
        return { ...item, matchId: item.match.id, actionLabel: action.label, actionEnabled: action.enabled,
          plannedLabel: item.match.plannedAt ? formatLocalDate(item.match.plannedAt) : '时间待定' }
      }), errorMessage: '' })
    } catch (error) {
      this.setData({ errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}) })
    } finally { this.setData({ loading: false }) }
  },
})
