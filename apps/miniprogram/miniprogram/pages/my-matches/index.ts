import type { MyMatchResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { competitionErrorMessage, formatLocalDate } from '../competitions/competitions.viewmodel'
import { primaryAction, scheduleMeta } from './matches.viewmodel'

type LoadOptions = { seasonId?: string; upcomingOnly?: string }

Page({
  data: {
    loading: true,
    errorMessage: '',
    seasonId: '',
    upcomingOnly: false,
    pageTitle: '我的比赛',
    pageKicker: '比赛任务',
    items: [] as Array<MyMatchResponse & { matchId: string; actionLabel: string; actionEnabled: boolean; plannedLabel: string; scheduleMeta: string }>
  },
  onLoad(options: LoadOptions) {
    const upcomingOnly = options.upcomingOnly === '1'
    this.setData({
      seasonId: options.seasonId ?? '',
      upcomingOnly,
      pageTitle: upcomingOnly ? '我的赛程' : '我的比赛',
      pageKicker: upcomingOnly ? '当前赛季' : '比赛任务',
    })
    void this.load()
  },
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
      const response = await competitionsApi.myMatches({
        limit: 100,
        seasonId: this.data.seasonId || undefined,
        upcomingOnly: this.data.upcomingOnly,
      })
      this.setData({ items: response.items.map((item) => {
        const action = primaryAction(item.action)
        const side = item.match.homeParticipant.id === item.myParticipantId ? 'HOME' : 'AWAY'
        return { ...item, matchId: item.match.id, actionLabel: action.label, actionEnabled: action.enabled,
          plannedLabel: item.match.plannedAt ? formatLocalDate(item.match.plannedAt) : '时间待定',
          scheduleMeta: scheduleMeta(item.match.roundNumber, side) }
      }), errorMessage: '' })
    } catch (error) {
      this.setData({ errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}) })
    } finally { this.setData({ loading: false }) }
  },
})
