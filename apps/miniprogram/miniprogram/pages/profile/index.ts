import type { CurrentUserResponse, GameAccountResponse } from '@efm/contracts'
import { ApiError, api } from '../../services/api'
import { platformLabel, sortAccounts } from './profile.viewmodel'

type InputEvent = { detail: { value: string } }
type AccountTapEvent = { currentTarget: { dataset: { id?: string } } }
type ProfileAccount = GameAccountResponse & { platformName: string }

function errorCopy(error: unknown): string {
  return error instanceof ApiError ? error.message : '加载失败，请检查网络后重试'
}

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    saving: false,
    user: null as CurrentUserResponse | null,
    accounts: [] as ProfileAccount[],
    hasAccounts: false,
    displayName: '',
    avatarUrl: '',
    region: '',
    profileCanSave: false,
  },

  onLoad() {
    void this.loadPage()
  },

  onShow() {
    if (this.data.state === 'loaded') void this.loadPage(false)
  },

  onPullDownRefresh() {
    void this.loadPage(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadPage(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      const [user, accounts] = await Promise.all([
        api.request<CurrentUserResponse>({ path: '/me' }),
        api.request<GameAccountResponse[]>({ path: '/me/game-accounts' }),
      ])
      const displayAccounts = sortAccounts(accounts).map((item) => ({
        ...item,
        platformName: platformLabel(item.platform),
      }))
      this.setData({
        state: 'loaded',
        errorMessage: '',
        user,
        accounts: displayAccounts,
        hasAccounts: displayAccounts.length > 0,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? '',
        region: user.region ?? '',
        profileCanSave: Boolean(user.displayName.trim()),
      })
    } catch (error) {
      this.setData({ state: 'error', errorMessage: errorCopy(error) })
    }
  },

  onDisplayNameInput(event: InputEvent) {
    this.setData({
      displayName: event.detail.value,
      profileCanSave: Boolean(event.detail.value.trim()),
    })
  },

  onAvatarUrlInput(event: InputEvent) {
    this.setData({ avatarUrl: event.detail.value })
  },

  onRegionInput(event: InputEvent) {
    this.setData({ region: event.detail.value })
  },

  async saveProfile() {
    if (!this.data.profileCanSave || this.data.saving) return
    this.setData({ saving: true, errorMessage: '' })
    try {
      const user = await api.request<CurrentUserResponse>({
        path: '/me',
        method: 'PATCH',
        data: {
          displayName: this.data.displayName.trim(),
          avatarUrl: this.data.avatarUrl.trim() || null,
          region: this.data.region.trim() || null,
        },
      })
      this.setData({
        user,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? '',
        region: user.region ?? '',
      })
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } catch (error) {
      this.setData({ errorMessage: errorCopy(error) })
    } finally {
      this.setData({ saving: false })
    }
  },

  addAccount() {
    wx.navigateTo({ url: '/pages/game-account-edit/index' })
  },

  openMyMatches() {
    wx.navigateTo({ url: '/pages/my-matches/index' })
  },

  createCompetition() {
    wx.navigateTo({ url: '/pages/competition-editor/index' })
  },

  editAccount(event: AccountTapEvent) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/game-account-edit/index?id=${encodeURIComponent(id)}` })
  },
})
