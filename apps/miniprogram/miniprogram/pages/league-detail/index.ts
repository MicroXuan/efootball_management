import type { GameAccountResponse, LeagueDetail, LeagueSeasonSummary, SeasonEntryResponse, TeamProfileResponse } from '@efm/contracts'
import { ApiError, api } from '../../services/api'
import { leaguesApi } from '../../services/leagues'
import { session } from '../../services/session'
import { platformLabel } from '../profile/profile.viewmodel'
import {
  defaultSeasonAccountId,
  deriveSeasonAction,
  leagueDetailErrorMessage,
  seasonStructureCopy,
  selectSeason,
  type SeasonAction,
} from './detail.viewmodel'

type LoadOptions = { id?: string }
type SeasonPickerEvent = { detail: { value: string } }
type AccountPickerEvent = { detail: { value: string } }

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    mutating: false,
    leagueId: '',
    league: null as LeagueDetail | null,
    seasons: [] as LeagueSeasonSummary[],
    seasonLabels: [] as string[],
    selectedSeasonIndex: 0,
    selectedSeason: null as LeagueSeasonSummary | null,
    structureCopy: '',
    registrationCloseDate: '',
    leagueLogoText: '',
    loggedIn: false,
    profile: null as TeamProfileResponse | null,
    accounts: [] as Array<GameAccountResponse & { label: string }>,
    rawAccounts: [] as GameAccountResponse[],
    selectedAccountIndex: 0,
    selectedAccountId: '',
    selectedAccountLabel: '暂无可用账号',
    entry: null as SeasonEntryResponse | null,
    action: { kind: 'NONE', label: '暂无可用操作', tone: 'muted' } as SeasonAction,
  },

  onLoad(options: LoadOptions) {
    if (!options.id) {
      this.setData({ state: 'error', errorMessage: '联赛参数缺失' })
      return
    }
    this.setData({ leagueId: options.id })
    void this.loadPage()
  },

  onPullDownRefresh() {
    void this.loadPage(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadPage(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      const loggedIn = Boolean(session.getAccessToken())
      const [league, seasons, profile, accounts] = await Promise.all([
        this.loadLeague(),
        leaguesApi.seasons(this.data.leagueId),
        loggedIn ? leaguesApi.teamProfile() : Promise.resolve(null),
        loggedIn ? api.request<GameAccountResponse[]>({ path: '/me/game-accounts' }) : Promise.resolve([]),
      ])
      const selectedSeason = selectSeason(seasons, this.data.selectedSeason?.id)
      const selectedAccountId = defaultSeasonAccountId(profile, accounts)
      const selectedAccountIndex = Math.max(0, accounts.findIndex((account) => account.id === selectedAccountId))
      this.setData({
        state: 'loaded', errorMessage: '', league, seasons, loggedIn,
        seasonLabels: seasons.map((season) => season.displayName),
        selectedSeasonIndex: Math.max(0, seasons.findIndex((season) => season.id === selectedSeason?.id)),
        selectedSeason,
        structureCopy: selectedSeason ? seasonStructureCopy(selectedSeason) : '',
        registrationCloseDate: selectedSeason?.registrationClosesAt.slice(0, 10) ?? '',
        leagueLogoText: league.shortName.slice(0, 2),
        profile,
        rawAccounts: accounts,
        accounts: accounts.map((account) => ({ ...account, label: `${platformLabel(account.platform)} · ${account.serverRegion} · ${account.gamerTag}` })),
        selectedAccountId,
        selectedAccountIndex,
        selectedAccountLabel: this.accountLabel(accounts.find((account) => account.id === selectedAccountId)),
      })
      await this.loadEntry()
    } catch (error) {
      this.setData({ state: 'error', errorMessage: this.errorCopy(error) })
    }
  },

  async loadLeague(): Promise<LeagueDetail> {
    return leaguesApi.detail(this.data.leagueId)
  },

  openManager() {
    if (!this.data.league?.capabilities.canManage) return
    wx.navigateTo({ url: `/pages/season-manage/index?leagueId=${encodeURIComponent(this.data.leagueId)}` })
  },

  async loadEntry() {
    const season = this.data.selectedSeason
    if (!season) {
      this.setData({ entry: null, action: deriveSeasonAction(Boolean(this.data.profile), null, 'COMPLETED', this.data.loggedIn) })
      return
    }
    if (!this.data.loggedIn) {
      this.setData({ entry: null, action: deriveSeasonAction(false, null, season.status, false) })
      return
    }
    const entry = await leaguesApi.myEntry(season.id)
    this.setData({ entry, action: deriveSeasonAction(Boolean(this.data.profile), entry, season.status) })
  },

  onSeasonChange(event: SeasonPickerEvent) {
    const index = Number(event.detail.value)
    const selectedSeason = this.data.seasons[index]
    if (!selectedSeason) return
    this.setData({
      selectedSeasonIndex: index,
      selectedSeason,
      structureCopy: seasonStructureCopy(selectedSeason),
      registrationCloseDate: selectedSeason.registrationClosesAt.slice(0, 10),
      entry: null,
      action: deriveSeasonAction(Boolean(this.data.profile), null, selectedSeason.status, this.data.loggedIn),
    })
    void this.loadEntry().catch((error: unknown) => this.setData({ errorMessage: this.errorCopy(error) }))
  },

  onAccountChange(event: AccountPickerEvent) {
    const index = Number(event.detail.value)
    const account = this.data.rawAccounts[index]
    if (!account) return
    this.setData({ selectedAccountIndex: index, selectedAccountId: account.id, selectedAccountLabel: this.accountLabel(account) })
  },

  async performAction() {
    if (this.data.mutating) return
    const season = this.data.selectedSeason
    const action = this.data.action
    if (action.kind === 'LOGIN') {
      wx.navigateTo({ url: '/pages/login/index' })
      return
    }
    if (action.kind === 'TEAM_PROFILE') {
      wx.navigateTo({ url: '/pages/team-profile/index' })
      return
    }
    if (!season || action.kind === 'NONE') return
    if (!this.data.selectedAccountId && (action.kind === 'APPLY' || action.kind === 'RENEW')) {
      this.setData({ errorMessage: '请先添加并选择一个游戏账号' })
      return
    }
    if (action.kind === 'WITHDRAW') {
      const confirmed = await this.confirmWithdraw()
      if (!confirmed) return
    }
    this.setData({ mutating: true, errorMessage: '' })
    try {
      if (action.kind === 'APPLY') {
        await leaguesApi.apply(season.id, { gameAccountId: this.data.selectedAccountId })
      } else if (action.kind === 'RENEW' && this.data.entry) {
        await leaguesApi.confirmRenewal(season.id, {
          gameAccountId: this.data.selectedAccountId,
          expectedVersion: this.data.entry.version,
        })
      } else if (action.kind === 'WITHDRAW' && this.data.entry) {
        await leaguesApi.withdraw(season.id, this.data.entry.version)
      }
      await this.loadEntry()
      wx.showToast({ title: '报名状态已更新', icon: 'success' })
    } catch (error) {
      this.setData({ errorMessage: this.errorCopy(error) })
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') await this.loadPage(false)
    } finally {
      this.setData({ mutating: false })
    }
  },

  confirmWithdraw(): Promise<boolean> {
    return new Promise((resolve) => wx.showModal({
      title: '撤回赛季报名？',
      content: '撤回后本赛季不会进入正式分组。',
      confirmText: '确认撤回',
      success: ({ confirm }) => resolve(confirm),
      fail: () => resolve(false),
    }))
  },

  accountLabel(account?: GameAccountResponse): string {
    return account ? `${platformLabel(account.platform)} · ${account.serverRegion} · ${account.gamerTag}` : '暂无可用账号'
  },

  errorCopy(error: unknown): string {
    return error instanceof ApiError ? leagueDetailErrorMessage(error.code) : leagueDetailErrorMessage('UNKNOWN')
  },
})
