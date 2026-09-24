import type { GameAccountResponse, GamePlatform } from '@efm/contracts'
import { ApiError, api } from '../../services/api'
import {
  accountErrorMessage,
  deleteConfirmation,
  isAccountFormValid,
  platformLabel,
} from '../profile/profile.viewmodel'

type InputEvent = { detail: { value: string } }
type PickerEvent = { detail: { value: string } }
type SwitchEvent = { detail: { value: boolean } }

const platforms: GamePlatform[] = ['MOBILE', 'PLAYSTATION', 'XBOX', 'STEAM']

function confirmDelete(account: GameAccountResponse): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      ...deleteConfirmation(account),
      confirmText: '删除',
      confirmColor: '#d94c42',
      success: ({ confirm }) => resolve(confirm),
      fail: () => resolve(false),
    })
  })
}

Page({
  data: {
    accountId: '',
    editing: false,
    loading: false,
    saving: false,
    deleting: false,
    errorMessage: '',
    platformLabels: platforms.map(platformLabel),
    platformIndex: 0,
    platform: 'MOBILE' as GamePlatform,
    serverRegion: '',
    gamerTag: '',
    gameUid: '',
    isDefault: false,
    saveEnabled: false,
    originalAccount: null as GameAccountResponse | null,
  },

  onLoad(options: Record<string, string | undefined>) {
    const accountId = options.id ? decodeURIComponent(options.id) : ''
    if (!accountId) return
    this.setData({ accountId, editing: true })
    void this.loadAccount(accountId)
  },

  async loadAccount(accountId: string) {
    this.setData({ loading: true, errorMessage: '' })
    try {
      const accounts = await api.request<GameAccountResponse[]>({ path: '/me/game-accounts' })
      const account = accounts.find(({ id }) => id === accountId)
      if (!account) {
        this.setData({ errorMessage: accountErrorMessage('GAME_ACCOUNT_NOT_FOUND') })
        return
      }
      this.setData({
        originalAccount: account,
        platformIndex: platforms.indexOf(account.platform),
        platform: account.platform,
        serverRegion: account.serverRegion,
        gamerTag: account.gamerTag,
        gameUid: account.gameUid ?? '',
        isDefault: account.isDefault,
        saveEnabled: true,
      })
    } catch (error) {
      this.setData({ errorMessage: this.errorMessage(error) })
    } finally {
      this.setData({ loading: false })
    }
  },

  errorMessage(error: unknown): string {
    return error instanceof ApiError ? accountErrorMessage(error.code) : '操作未完成，请稍后重试'
  },

  updateValidity(next: Partial<{ platform: GamePlatform; serverRegion: string; gamerTag: string }> = {}) {
    this.setData({
      saveEnabled: isAccountFormValid({
        platform: next.platform ?? this.data.platform,
        serverRegion: next.serverRegion ?? this.data.serverRegion,
        gamerTag: next.gamerTag ?? this.data.gamerTag,
      }),
    })
  },

  onPlatformChange(event: PickerEvent) {
    const platformIndex = Number(event.detail.value)
    const platform = platforms[platformIndex]
    if (!platform) return
    this.setData({ platformIndex, platform })
    this.updateValidity({ platform })
  },

  onServerRegionInput(event: InputEvent) {
    this.setData({ serverRegion: event.detail.value })
    this.updateValidity({ serverRegion: event.detail.value })
  },

  onGamerTagInput(event: InputEvent) {
    this.setData({ gamerTag: event.detail.value })
    this.updateValidity({ gamerTag: event.detail.value })
  },

  onGameUidInput(event: InputEvent) {
    this.setData({ gameUid: event.detail.value })
  },

  onDefaultChange(event: SwitchEvent) {
    this.setData({ isDefault: event.detail.value })
  },

  async saveAccount() {
    if (!this.data.saveEnabled || this.data.saving) return
    this.setData({ saving: true, errorMessage: '' })
    try {
      const path = this.data.editing
        ? `/me/game-accounts/${encodeURIComponent(this.data.accountId)}`
        : '/me/game-accounts'
      await api.request<GameAccountResponse>({
        path,
        method: this.data.editing ? 'PATCH' : 'POST',
        data: {
          platform: this.data.platform,
          serverRegion: this.data.serverRegion.trim(),
          gamerTag: this.data.gamerTag.trim(),
          gameUid: this.data.gameUid.trim() || null,
          isDefault: this.data.isDefault,
        },
      })
      wx.showToast({ title: this.data.editing ? '账号已更新' : '账号已添加', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) {
      this.setData({ errorMessage: this.errorMessage(error) })
    } finally {
      this.setData({ saving: false })
    }
  },

  async deleteAccount() {
    const account = this.data.originalAccount
    if (!account || this.data.deleting || !(await confirmDelete(account))) return
    this.setData({ deleting: true, errorMessage: '' })
    try {
      await api.request<{ ok: true }>({
        path: `/me/game-accounts/${encodeURIComponent(account.id)}`,
        method: 'DELETE',
      })
      wx.showToast({ title: '账号已删除', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) {
      this.setData({ errorMessage: this.errorMessage(error) })
    } finally {
      this.setData({ deleting: false })
    }
  },

  goBack() {
    wx.navigateBack()
  },
})
