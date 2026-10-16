import type { CurrentUserResponse } from '@efm/contracts'
import { featureFlags } from '../../config/features'
import { ApiError, api } from '../../services/api'
import { auth } from '../../services/auth'
import { leaguesApi } from '../../services/leagues'
import { session } from '../../services/session'
import { actionCenterAttentionCount, loadActionCenter, readActionCenterVersions } from '../../services/action-center'
import { actionCenterSourceAttention } from '../action-center/action-center.viewmodel'
import { profileView, type ProfileView } from './profile.viewmodel'
import { completeProfileLogin } from './profile-login'

type TeamTapEvent = { currentTarget: { dataset: { id?: string } } }

function errorCopy(error: unknown): string {
  return error instanceof ApiError ? error.message : '加载失败，请检查网络后重试'
}

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    loginLoading: false,
    loggedIn: false,
    features: featureFlags,
    profile: profileView(null, []) as ProfileView,
    actionCenter: { attentionCount: 0, actionRequiredCount: 0, auctionCount: 0 },
  },

  onShow() {
    this.getTabBar?.()?.setData({ selected: 2 })
    void this.loadPage()
  },

  onPullDownRefresh() {
    void this.loadPage(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadPage(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    const loggedIn = Boolean(session.getAccessToken())
    if (!loggedIn) {
      this.setData({ state: 'loaded', errorMessage: '', loggedIn: false, profile: profileView(null, []), actionCenter: { attentionCount: 0, actionRequiredCount: 0, auctionCount: 0 } })
      return
    }
    try {
      const [user, teams, actionCenter] = await Promise.all([
        api.request<CurrentUserResponse>({ path: '/me' }),
        leaguesApi.mine(),
        loadActionCenter().catch(() => ({ items: [], actionRequiredCount: 0 })),
      ])
      const readVersions = readActionCenterVersions()
      const sourceCounts = actionCenterSourceAttention(actionCenter, readVersions)
      const attentionCount = actionCenterAttentionCount(actionCenter, readVersions)
      this.setData({
        state: 'loaded',
        errorMessage: '',
        loggedIn: true,
        profile: profileView(user, teams.items),
        actionCenter: { attentionCount, actionRequiredCount: actionCenter.actionRequiredCount, auctionCount: sourceCounts.AUCTION },
      })
    } catch (error) {
      this.setData({ state: 'error', errorMessage: errorCopy(error), loggedIn: true })
    }
  },

  async login() {
    await completeProfileLogin(this, () => auth.login(), errorCopy)
  },

  copyUserNo() {
    const value = this.data.profile.publicUserNoCopy
    if (value) wx.setClipboardData({ data: value })
  },

  openFavorites() {
    wx.navigateTo({ url: '/pages/favorites/index' })
  },

  openActionCenter() {
    wx.navigateTo({ url: '/pages/action-center/index' })
  },

  openMyMatches() {
    wx.navigateTo({ url: '/pages/my-matches/index' })
  },

  openPlayerAuctions() {
    wx.navigateTo({ url: '/pages/player-auctions/index' })
  },

  openWechatBotBinding() {
    wx.navigateTo({ url: '/pages/wechat-bot-binding/index' })
  },

  openTeam(event: TeamTapEvent) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/league-team-detail/index?id=${encodeURIComponent(id)}` })
  },
})
