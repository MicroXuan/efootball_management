import type {
  CompetitionDetail,
  CupBracketView,
  CupRegistrationResponse,
  CompetitionMatchResponse,
  CompetitionRegistrationResponse,
  CompetitionParticipantSummary,
  GameAccountResponse,
  SeasonEntryResponse,
  StandingsSnapshotResponse,
} from '@efm/contracts'
import { ApiError, api } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { session } from '../../services/session'
import { competitionErrorMessage, formatLocalDate, lifecycleLabel } from '../competitions/competitions.viewmodel'
import { bracketBoardRounds, cupRegistrationAvailability, cupScheduleSections, eligibleAccounts, isCupCompetition, registrationAvailability, standingsEmpty, type BracketBoardRound, type CupScheduleSection, type EligibleAccount } from './detail.viewmodel'

type DetailTab = 'overview' | 'schedule' | 'standings' | 'bracket'

Page({
  data: {
    id: '', loading: true, acting: false, errorMessage: '', activeTab: 'overview' as DetailTab,
    detail: null as CompetitionDetail | null,
    lifecycleName: '', registrationWindow: '', startLabel: '',
    matches: [] as CompetitionMatchResponse[],
    scheduleSections: [] as CupScheduleSection[],
    selectedStageId: '',
    activeCupSchedule: null as CupScheduleSection | null,
    standings: null as StandingsSnapshotResponse | null,
    bracket: null as CupBracketView | null,
    bracketRounds: [] as BracketBoardRound[],
    showBracket: false,
    isCup: false,
    standingsIsEmpty: true,
    accounts: [] as EligibleAccount[],
    selectedAccountId: '',
    registration: null as CompetitionRegistrationResponse | null,
    cupRegistration: null as CupRegistrationResponse | null,
    cupParticipants: [] as CompetitionParticipantSummary[],
    seasonEntry: null as SeasonEntryResponse | null,
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
  selectScheduleStage(event: { currentTarget: { dataset: { id?: string } } }) {
    const stageId = event.currentTarget.dataset.id
    if (!stageId) return
    const section = this.data.scheduleSections.find((item) => item.stageId === stageId)
    if (section) this.setData({ selectedStageId: stageId, activeCupSchedule: section })
  },
  manage() { wx.navigateTo({ url: `/pages/competition-manage/index?id=${encodeURIComponent(this.data.id)}` }) },
  openBracketPanorama() {
    const myTeamName = this.data.cupRegistration?.teamName ?? this.data.seasonEntry?.teamNameSnapshot ?? ''
    const mineQuery = myTeamName ? `&mine=${encodeURIComponent(myTeamName)}` : ''
    wx.navigateTo({ url: `/pages/cup-bracket-panorama/index?id=${encodeURIComponent(this.data.id)}${mineQuery}` })
  },
  openMyMatches() {
    if (this.data.isCup) {
      this.setData({ activeTab: 'schedule' })
      wx.pageScrollTo({ selector: '#competition-tabs', duration: 300 })
      return
    }
    wx.navigateTo({ url: '/pages/my-matches/index' })
  },
  selectAccount(event: { currentTarget: { dataset: { id?: string; eligible?: boolean } } }) {
    if (event.currentTarget.dataset.eligible && event.currentTarget.dataset.id) {
      this.setData({ selectedAccountId: event.currentTarget.dataset.id })
    }
  },

  async load() {
    if (!this.data.id) return
    this.setData({ loading: true, errorMessage: '' })
    try {
      const publicDetail = await competitionsApi.detail(this.data.id)
      const showBracket = isCupCompetition(publicDetail)
      const bracketAvailable = showBracket && publicDetail.status !== 'REGISTRATION_OPEN'
      const [matches, standings, bracket, cupParticipants] = await Promise.all([
        competitionsApi.matches(this.data.id),
        competitionsApi.standings(this.data.id),
        bracketAvailable ? competitionsApi.bracket(this.data.id) : Promise.resolve(null),
        showBracket ? competitionsApi.cupParticipants(this.data.id).catch(() => []) : Promise.resolve([]),
      ])
      const detail = publicDetail
      let accounts: GameAccountResponse[] = []
      let registration: CompetitionRegistrationResponse | null = null
      let cupRegistration: CupRegistrationResponse | null = null
      let seasonEntry: SeasonEntryResponse | null = null
      if (session.getAccessToken()) {
        if (showBracket) {
          [cupRegistration, seasonEntry] = await Promise.all([
            competitionsApi.cupRegistration(detail.id),
            detail.seasonId ? competitionsApi.seasonEntry(detail.seasonId) : Promise.resolve(null),
          ])
        } else {
          const [rawAccounts, mine] = await Promise.all([
            api.request<GameAccountResponse[]>({ path: '/me/game-accounts' }), competitionsApi.mine(undefined, 100),
          ])
          accounts = rawAccounts
          const mineRegistration = mine.items.find((item) => item.competition.id === detail.id)?.registration
          registration = mineRegistration && 'gameAccountId' in mineRegistration ? mineRegistration : null
        }
      }
      const completeDetail = { ...detail, currentRegistration: registration }
      const displayAccounts = eligibleAccounts(accounts, completeDetail)
      const availability = showBracket
        ? cupRegistrationAvailability(completeDetail, seasonEntry, cupRegistration)
        : registrationAvailability(completeDetail, displayAccounts.filter(({ eligible }) => eligible).length)
      const scheduleSections = showBracket ? cupScheduleSections(matches) : []
      const activeCupSchedule = scheduleSections.find(({ stageId }) => stageId === this.data.selectedStageId)
        ?? scheduleSections[0]
        ?? null
      this.setData({
        detail: completeDetail,
        lifecycleName: lifecycleLabel(detail.status),
        registrationWindow: `截止 ${formatLocalDate(detail.registrationClosesAt)}`,
        startLabel: formatLocalDate(detail.startsAt),
        matches,
        scheduleSections,
        selectedStageId: activeCupSchedule?.stageId ?? '',
        activeCupSchedule,
        standings,
        bracket,
        bracketRounds: bracketBoardRounds(bracket),
        showBracket,
        isCup: showBracket,
        standingsIsEmpty: standingsEmpty(standings),
        accounts: displayAccounts,
        selectedAccountId: displayAccounts.find(({ eligible }) => eligible)?.id ?? '',
        registration,
        cupRegistration,
        cupParticipants,
        seasonEntry,
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
    if (!this.data.detail || this.data.acting) return
    if (!session.getAccessToken()) {
      wx.navigateTo({ url: '/pages/login/index' })
      return
    }
    if (this.data.isCup ? !this.data.seasonEntry : !this.data.selectedAccountId) return
    this.setData({ acting: true, errorMessage: '' })
    try {
      if (this.data.isCup) {
        await competitionsApi.registerCup(
          this.data.detail.id,
          this.data.seasonEntry!.id,
          this.data.detail.activeRuleVersion,
        )
      } else {
        await competitionsApi.register(this.data.detail.id, this.data.selectedAccountId, this.data.detail.activeRuleVersion)
      }
      wx.showToast({ title: '报名已提交', icon: 'success' })
      await this.load()
    } catch (error) {
      this.setData({ errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}) })
    } finally { this.setData({ acting: false }) }
  },

  withdraw() {
    const registration = this.data.isCup ? this.data.cupRegistration : this.data.registration
    if (!registration || this.data.acting) return
    wx.showModal({
      title: '撤回报名', content: '撤回后如仍在报名期，可重新提交。', confirmText: '确认撤回',
      success: ({ confirm }) => { if (confirm) void this.performWithdraw(registration) },
    })
  },

  async performWithdraw(registration: CompetitionRegistrationResponse | CupRegistrationResponse) {
    this.setData({ acting: true, errorMessage: '' })
    try {
      if (this.data.isCup) await competitionsApi.withdrawCup(this.data.id, registration.version)
      else await competitionsApi.withdraw(this.data.id, registration.version)
      wx.showToast({ title: '报名已撤回', icon: 'success' })
      await this.load()
    } catch (error) {
      this.setData({ errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}) })
    } finally { this.setData({ acting: false }) }
  },
})
