import type {
  CompetitionDetail,
  CompetitionMatchResponse,
  CompetitionRegistrationResponse,
  GameAccountResponse,
  StandingsSnapshotResponse,
} from '@efm/contracts'
import { ApiError, api } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { session } from '../../services/session'
import { competitionErrorMessage, formatLocalDate, lifecycleLabel } from '../competitions/competitions.viewmodel'
import { eligibleAccounts, registrationAvailability, standingsEmpty, type EligibleAccount } from './detail.viewmodel'

type DetailTab = 'overview' | 'schedule' | 'standings'

Page({
  data: {
    id: '', loading: true, acting: false, errorMessage: '', activeTab: 'overview' as DetailTab,
    detail: null as CompetitionDetail | null,
    lifecycleName: '', registrationWindow: '', startLabel: '',
    matches: [] as CompetitionMatchResponse[],
    standings: null as StandingsSnapshotResponse | null,
    standingsIsEmpty: true,
    accounts: [] as EligibleAccount[],
    selectedAccountId: '',
    registration: null as CompetitionRegistrationResponse | null,
    registrationEnabled: false,
    registrationReason: '',
    loggedIn: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id ?? '', loggedIn: Boolean(session.getAccessToken()) })
    void this.load()
  },

  onPullDownRefresh() { void this.load().finally(() => wx.stopPullDownRefresh()) },
  retry() { void this.load() },
  switchTab(event: { currentTarget: { dataset: { tab?: DetailTab } } }) {
    if (event.currentTarget.dataset.tab) this.setData({ activeTab: event.currentTarget.dataset.tab })
  },
  manage() { wx.navigateTo({ url: `/pages/competition-manage/index?id=${encodeURIComponent(this.data.id)}` }) },
  openMyMatches() { wx.navigateTo({ url: '/pages/my-matches/index' }) },
  selectAccount(event: { currentTarget: { dataset: { id?: string; eligible?: boolean } } }) {
    if (event.currentTarget.dataset.eligible && event.currentTarget.dataset.id) {
      this.setData({ selectedAccountId: event.currentTarget.dataset.id })
    }
  },

  async load() {
    if (!this.data.id) return
    this.setData({ loading: true, errorMessage: '' })
    try {
      const [publicDetail, matches, standings] = await Promise.all([
        competitionsApi.detail(this.data.id), competitionsApi.matches(this.data.id), competitionsApi.standings(this.data.id),
      ])
      const detail = session.getAccessToken()
        ? await competitionsApi.managerDetail(this.data.id).catch(() => publicDetail)
        : publicDetail
      let accounts: GameAccountResponse[] = []
      let registration: CompetitionRegistrationResponse | null = null
      if (session.getAccessToken()) {
        const [rawAccounts, mine] = await Promise.all([
          api.request<GameAccountResponse[]>({ path: '/me/game-accounts' }), competitionsApi.mine(undefined, 100),
        ])
        accounts = rawAccounts
        registration = mine.items.find((item) => item.competition.id === detail.id)?.registration ?? null
      }
      const completeDetail = { ...detail, currentRegistration: registration }
      const displayAccounts = eligibleAccounts(accounts, completeDetail)
      const availability = registrationAvailability(completeDetail, displayAccounts.filter(({ eligible }) => eligible).length)
      this.setData({
        detail: completeDetail,
        lifecycleName: lifecycleLabel(detail.status),
        registrationWindow: `截止 ${formatLocalDate(detail.registrationClosesAt)}`,
        startLabel: formatLocalDate(detail.startsAt),
        matches,
        standings,
        standingsIsEmpty: standingsEmpty(standings),
        accounts: displayAccounts,
        selectedAccountId: displayAccounts.find(({ eligible }) => eligible)?.id ?? '',
        registration,
        registrationEnabled: availability.enabled,
        registrationReason: availability.reason,
      })
    } catch (error) {
      this.setData({ errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}) })
    } finally {
      this.setData({ loading: false })
    }
  },

  async register() {
    if (!this.data.detail || !this.data.selectedAccountId || this.data.acting) return
    if (!session.getAccessToken()) {
      wx.navigateTo({ url: '/pages/login/index' })
      return
    }
    this.setData({ acting: true, errorMessage: '' })
    try {
      await competitionsApi.register(this.data.detail.id, this.data.selectedAccountId, this.data.detail.activeRuleVersion)
      wx.showToast({ title: '报名已提交', icon: 'success' })
      await this.load()
    } catch (error) {
      this.setData({ errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}) })
    } finally { this.setData({ acting: false }) }
  },

  withdraw() {
    const registration = this.data.registration
    if (!registration || this.data.acting) return
    wx.showModal({
      title: '撤回报名', content: '撤回后如仍在报名期，可重新提交。', confirmText: '确认撤回',
      success: ({ confirm }) => { if (confirm) void this.performWithdraw(registration) },
    })
  },

  async performWithdraw(registration: CompetitionRegistrationResponse) {
    this.setData({ acting: true, errorMessage: '' })
    try {
      await competitionsApi.withdraw(this.data.id, registration.version)
      wx.showToast({ title: '报名已撤回', icon: 'success' })
      await this.load()
    } catch (error) {
      this.setData({ errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}) })
    } finally { this.setData({ acting: false }) }
  },
})
