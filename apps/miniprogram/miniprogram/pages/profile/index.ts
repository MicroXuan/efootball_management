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
import { consumeMyLeaguesTabRequest, requestMyLeaguesTab } from '../leagues/league-list-navigation'

type TeamTapEvent = { currentTarget: { dataset: { id?: string } } }
type NicknameInputEvent = { detail: { value: string } }

function errorCopy(error: unknown): string {
  return error instanceof ApiError ? error.message : '加载失败，请检查网络后重试'
}

let loadVersion = 0

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    loginLoading: false,
    loggedIn: false,
    currentUser: null as CurrentUserResponse | null,
    features: featureFlags,
    profile: profileView(null, []) as ProfileView,
    editingName: false,
    displayNameDraft: '',
    nameSaving: false,
    actionCenter: { attentionCount: 0, actionRequiredCount: 0, auctionCount: 0 },
  },

  onShow() {
    this.getTabBar?.()?.setData({ selected: 2 })
    void this.loadPage(this.data.state !== 'loaded')
  },

  onPullDownRefresh() {
    void this.loadPage(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadPage(showLoading = true) {
    const currentVersion = ++loadVersion
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    const loggedIn = Boolean(session.getAccessToken())
    if (!loggedIn) {
      this.setData({ state: 'loaded', errorMessage: '', loggedIn: false, profile: profileView(null, []), actionCenter: { attentionCount: 0, actionRequiredCount: 0, auctionCount: 0 } })
      return
    }
    try {
      const actionCenterPromise = loadActionCenter().catch(() => ({ items: [], actionRequiredCount: 0 }))
      const [user, teams] = await Promise.all([
        api.request<CurrentUserResponse>({ path: '/me' }),
        leaguesApi.mine(),
      ])
      if (currentVersion !== loadVersion) return
      this.setData({
        state: 'loaded', errorMessage: '', loggedIn: true,
        currentUser: user, profile: profileView(user, teams.items),
      })
      const actionCenter = await actionCenterPromise
      if (currentVersion !== loadVersion) return
      const readVersions = readActionCenterVersions()
      const sourceCounts = actionCenterSourceAttention(actionCenter, readVersions)
      const attentionCount = actionCenterAttentionCount(actionCenter, readVersions)
      this.setData({
        actionCenter: { attentionCount, actionRequiredCount: actionCenter.actionRequiredCount, auctionCount: sourceCounts.AUCTION },
      })
    } catch (error) {
      if (currentVersion !== loadVersion) return
      this.setData({
        state: !showLoading && this.data.state === 'loaded' ? 'loaded' : 'error',
        errorMessage: errorCopy(error),
        loggedIn: true,
      })
    }
  },

  async login() {
    await completeProfileLogin(this, () => auth.login(), errorCopy)
  },

  copyUserNo() {
    const value = this.data.profile.publicUserNoCopy
    if (value) wx.setClipboardData({ data: value })
  },

  startEditingName() {
    this.setData({ editingName: true, displayNameDraft: this.data.profile.displayName, errorMessage: '' })
  },

  cancelEditingName() {
    if (!this.data.nameSaving) this.setData({ editingName: false, displayNameDraft: '', errorMessage: '' })
  },

  onDisplayNameInput(event: NicknameInputEvent) {
    this.setData({ displayNameDraft: event.detail.value })
  },

  async saveDisplayName() {
    const displayName = this.data.displayNameDraft.trim()
    const currentUser = this.data.currentUser
    if (!currentUser || this.data.nameSaving) return
    if (!displayName || displayName.length > 32) {
      this.setData({ errorMessage: '昵称需要填写 1—32 个字符' })
      return
    }
    this.setData({ nameSaving: true, errorMessage: '' })
    try {
      const updated = await api.request<CurrentUserResponse>({
        path: '/me', method: 'PATCH',
        data: { displayName, avatarUrl: currentUser.avatarUrl, region: currentUser.region },
      })
      this.setData({
        currentUser: updated,
        profile: { ...this.data.profile, displayName: updated.displayName },
        editingName: false,
        displayNameDraft: '',
      })
      wx.showToast({ title: '昵称已更新', icon: 'success' })
    } catch (error) {
      this.setData({ errorMessage: errorCopy(error) })
    } finally {
      this.setData({ nameSaving: false })
    }
  },

  openFavorites() {
    wx.navigateTo({ url: '/pages/favorites/index' })
  },

  openActionCenter() {
    wx.navigateTo({ url: '/pages/action-center/index' })
  },

  openMyLeagues() {
    requestMyLeaguesTab()
    wx.switchTab({
      url: '/pages/leagues/index',
      fail: () => { consumeMyLeaguesTabRequest() },
    })
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
