import type { GameAccountResponse, TeamProfileResponse } from '@efm/contracts'
import { ApiError, api } from '../../services/api'
import { leaguesApi } from '../../services/leagues'
import { platformLabel, sortAccounts } from '../profile/profile.viewmodel'
import {
  buildTeamProfileForm,
  isTeamProfileFormValid,
  selectedAccount,
  teamProfileErrorMessage,
  teamProfileMode,
  teamProfileSavedMessage,
  type TeamProfileForm,
} from './team-profile.viewmodel'

type InputEvent = { detail: { value: string } }
type PickerEvent = { detail: { value: string } }
type DisplayAccount = GameAccountResponse & { label: string }

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    saving: false,
    profile: null as TeamProfileResponse | null,
    accounts: [] as DisplayAccount[],
    rawAccounts: [] as GameAccountResponse[],
    selectedAccountIndex: 0,
    selectedAccountLabel: '请选择游戏账号',
    form: buildTeamProfileForm(null, []) as TeamProfileForm,
    mode: 'create' as 'create' | 'edit',
    title: '建立球队档案',
    actionLabel: '创建球队',
    canSave: false,
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
      const [profile, rawAccounts] = await Promise.all([
        leaguesApi.teamProfile(),
        api.request<GameAccountResponse[]>({ path: '/me/game-accounts' }),
      ])
      const sorted = sortAccounts(rawAccounts)
      const form = buildTeamProfileForm(profile, sorted)
      const accountIndex = Math.max(0, sorted.findIndex((item) => item.id === form.defaultGameAccountId))
      const account = selectedAccount(sorted, form.defaultGameAccountId)
      const presentation = teamProfileMode(profile)
      this.setData({
        state: 'loaded',
        errorMessage: '',
        profile,
        rawAccounts: sorted,
        accounts: sorted.map((item) => ({
          ...item,
          label: `${platformLabel(item.platform)} · ${item.serverRegion} · ${item.gamerTag}`,
        })),
        selectedAccountIndex: accountIndex,
        selectedAccountLabel: account
          ? `${platformLabel(account.platform)} · ${account.serverRegion} · ${account.gamerTag}`
          : '请先添加游戏账号',
        form,
        mode: presentation.mode,
        title: presentation.title,
        actionLabel: presentation.action,
        canSave: isTeamProfileFormValid(form, sorted),
      })
    } catch (error) {
      this.setData({ state: 'error', errorMessage: this.errorCopy(error) })
    }
  },

  onNameInput(event: InputEvent) {
    this.updateForm({ name: event.detail.value })
  },

  onShortNameInput(event: InputEvent) {
    this.updateForm({ shortName: event.detail.value })
  },

  onLogoInput(event: InputEvent) {
    this.updateForm({ logoUrl: event.detail.value })
  },

  onAccountChange(event: PickerEvent) {
    const index = Number(event.detail.value)
    const account = this.data.rawAccounts[index]
    if (!account) return
    this.setData({
      selectedAccountIndex: index,
      selectedAccountLabel: `${platformLabel(account.platform)} · ${account.serverRegion} · ${account.gamerTag}`,
    })
    this.updateForm({ defaultGameAccountId: account.id })
  },

  updateForm(change: Partial<TeamProfileForm>) {
    const form = { ...this.data.form, ...change }
    this.setData({ form, canSave: isTeamProfileFormValid(form, this.data.rawAccounts) })
  },

  async save() {
    if (!this.data.canSave || this.data.saving) return
    this.setData({ saving: true, errorMessage: '' })
    const input = {
      name: this.data.form.name.trim(),
      shortName: this.data.form.shortName.trim(),
      logoUrl: this.data.form.logoUrl.trim() || null,
      defaultGameAccountId: this.data.form.defaultGameAccountId,
    }
    try {
      const profileBeforeSave = this.data.profile
      const profile = profileBeforeSave
        ? await leaguesApi.updateTeamProfile({ ...input, expectedVersion: profileBeforeSave.version })
        : await leaguesApi.createTeamProfile(input)
      const presentation = teamProfileMode(profile)
      this.setData({
        profile,
        form: buildTeamProfileForm(profile, this.data.rawAccounts),
        mode: presentation.mode,
        title: presentation.title,
        actionLabel: presentation.action,
      })
      wx.showToast({ title: teamProfileSavedMessage(profileBeforeSave), icon: 'success' })
    } catch (error) {
      this.setData({ errorMessage: this.errorCopy(error) })
    } finally {
      this.setData({ saving: false })
    }
  },

  addAccount() {
    wx.navigateTo({ url: '/pages/game-account-edit/index' })
  },

  errorCopy(error: unknown): string {
    return error instanceof ApiError
      ? teamProfileErrorMessage(error.code)
      : '球队资料未保存，请稍后重试'
  },
})
