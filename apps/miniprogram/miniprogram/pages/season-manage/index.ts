import type { LeagueDetail, LeagueSeasonDetail, SeasonEntryResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { leaguesApi } from '../../services/leagues'
import {
  buildSeasonForm,
  entryStatusLabel,
  filterSeasonEntries,
  isRejectionReasonValid,
  managerTransitionAction,
  queueCounts,
  seasonManagerErrorMessage,
  seasonStatusLabel,
  type QueueFilter,
  type SeasonForm,
} from './manage.viewmodel'

type InputEvent = { currentTarget: { dataset: { field?: keyof SeasonForm } }; detail: { value: string } }
type SeasonPickerEvent = { detail: { value: string } }
type FilterTapEvent = { currentTarget: { dataset: { filter?: QueueFilter } } }
type EntryTapEvent = { currentTarget: { dataset: { id?: string } } }
type DisplayEntry = SeasonEntryResponse & { statusLabel: string; sourceLabel: string }

const filters: Array<{ value: QueueFilter; label: string }> = [
  { value: 'ALL', label: '全部' }, { value: 'INVITED', label: '待续赛' }, { value: 'PENDING', label: '待审核' },
  { value: 'APPROVED', label: '已通过' }, { value: 'REJECTED', label: '已拒绝' }, { value: 'WITHDRAWN', label: '已撤回' },
]

Page({
  data: {
    leagueId: '', requestedSeasonId: '', state: 'loading' as 'loading' | 'loaded' | 'error', errorMessage: '', mutating: false,
    league: null as LeagueDetail | null, seasons: [] as LeagueSeasonDetail[], seasonLabels: [] as string[], selectedSeasonIndex: 0,
    selectedSeason: null as LeagueSeasonDetail | null, selectedStatusLabel: '', transition: null as ReturnType<typeof managerTransitionAction>,
    entries: [] as SeasonEntryResponse[], visibleEntries: [] as DisplayEntry[], activeFilter: 'ALL' as QueueFilter, filters,
    invitedRenewals: 0, confirmedRenewals: 0, newApplicants: 0,
    showSeasonForm: false, form: null as SeasonForm | null, canCreateSeason: false,
  },

  onLoad(options: { leagueId?: string; seasonId?: string }) {
    if (!options.leagueId) {
      this.setData({ state: 'error', errorMessage: '联赛参数缺失' })
      return
    }
    this.setData({ leagueId: options.leagueId, requestedSeasonId: options.seasonId ?? '' })
    void this.loadPage()
  },

  onPullDownRefresh() {
    void this.loadPage(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadPage(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      const [league, seasons] = await Promise.all([
        leaguesApi.managerLeague(this.data.leagueId),
        leaguesApi.managerSeasons(this.data.leagueId),
      ])
      const requested = this.data.requestedSeasonId || this.data.selectedSeason?.id
      const selectedSeasonIndex = Math.max(0, seasons.findIndex(({ id }) => id === requested))
      const selectedSeason = seasons[selectedSeasonIndex] ?? null
      const nextNumber = seasons.reduce((max, season) => Math.max(max, season.seasonNumber), 0) + 1
      this.setData({
        state: 'loaded', league, seasons, seasonLabels: seasons.map(({ displayName }) => displayName), selectedSeasonIndex,
        selectedSeason, selectedStatusLabel: selectedSeason ? seasonStatusLabel(selectedSeason.status) : '',
        transition: selectedSeason ? managerTransitionAction(selectedSeason) : null,
        canCreateSeason: league.capabilities.canCreateSeason,
        showSeasonForm: seasons.length === 0,
        form: buildSeasonForm(league, nextNumber),
      })
      await this.loadEntries()
    } catch (error) {
      this.setData({ state: 'error', errorMessage: this.errorCopy(error).message })
    }
  },

  async loadEntries() {
    const season = this.data.selectedSeason
    if (!season?.capabilities.canReviewEntries) {
      this.applyEntries([])
      return
    }
    const entries = await leaguesApi.entries(season.id)
    this.applyEntries(entries)
  },

  applyEntries(entries: SeasonEntryResponse[]) {
    const counts = queueCounts(entries)
    const visibleEntries: DisplayEntry[] = filterSeasonEntries(entries, this.data.activeFilter).map((entry) => ({
      ...entry,
      statusLabel: entryStatusLabel(entry.status),
      sourceLabel: entry.source === 'RENEWAL' ? '续赛' : '新报名',
    }))
    this.setData({ entries, visibleEntries, ...counts })
  },

  onSeasonChange(event: SeasonPickerEvent) {
    const selectedSeasonIndex = Number(event.detail.value)
    const selectedSeason = this.data.seasons[selectedSeasonIndex]
    if (!selectedSeason) return
    this.setData({
      selectedSeasonIndex, selectedSeason, selectedStatusLabel: seasonStatusLabel(selectedSeason.status),
      transition: managerTransitionAction(selectedSeason), showSeasonForm: false, errorMessage: '',
    })
    void this.loadEntries().catch((error: unknown) => this.setData({ errorMessage: this.errorCopy(error).message }))
  },

  openSeasonCreator() {
    if (!this.data.league?.capabilities.canCreateSeason) return
    const nextNumber = this.data.seasons.reduce((max, season) => Math.max(max, season.seasonNumber), 0) + 1
    this.setData({ showSeasonForm: true, form: buildSeasonForm(this.data.league, nextNumber), errorMessage: '' })
  },

  closeSeasonCreator() {
    if (this.data.seasons.length) this.setData({ showSeasonForm: false, errorMessage: '' })
  },

  onInput(event: InputEvent) {
    const field = event.currentTarget.dataset.field
    if (!field || !this.data.form) return
    this.setData({ form: { ...this.data.form, [field]: event.detail.value } })
  },

  async createSeason() {
    const form = this.data.form
    if (!form || this.data.mutating || !this.data.league?.capabilities.canCreateSeason) return
    const dates = [form.registrationOpensAt, form.registrationClosesAt, form.startsAt, form.endsAt]
    if (dates.some((value) => Number.isNaN(Date.parse(value)))) {
      this.setData({ errorMessage: '请填写完整 ISO 时间，例如 2026-10-01T12:00:00.000Z' })
      return
    }
    if (!(Date.parse(dates[0]) < Date.parse(dates[1]) && Date.parse(dates[1]) < Date.parse(dates[2]) && Date.parse(dates[2]) < Date.parse(dates[3]))) {
      this.setData({ errorMessage: '时间顺序应为：开放报名、截止报名、开赛、结束' })
      return
    }
    this.setData({ mutating: true, errorMessage: '' })
    try {
      const season = await leaguesApi.createSeason(this.data.leagueId, {
        seasonNumber: form.seasonNumber, displayName: form.displayName.trim(),
        registrationOpensAt: form.registrationOpensAt, registrationClosesAt: form.registrationClosesAt,
        startsAt: form.startsAt, endsAt: form.endsAt,
        superCapacity: Number(form.superCapacity), championCapacity: Number(form.championCapacity), promotionCount: Number(form.promotionCount),
      })
      this.setData({ requestedSeasonId: season.id, showSeasonForm: false })
      await this.loadPage(false)
      wx.showToast({ title: '赛季草稿已创建', icon: 'success' })
    } catch (error) {
      this.setData({ errorMessage: this.errorCopy(error).message })
    } finally {
      this.setData({ mutating: false })
    }
  },

  async performTransition() {
    const season = this.data.selectedSeason
    const transition = this.data.transition
    if (!season || !transition || transition.kind === 'NEXT_PHASE' || this.data.mutating) return
    const confirmed = await this.confirmTransition(transition.kind)
    if (!confirmed) return
    this.setData({ mutating: true, errorMessage: '' })
    try {
      await leaguesApi.transitionSeason(season.id, transition.kind === 'OPEN' ? 'open-registration' : 'close-registration', season.version)
      await this.loadPage(false)
      wx.showToast({ title: transition.kind === 'OPEN' ? '报名已开放' : '报名已关闭', icon: 'success' })
    } catch (error) {
      const result = this.errorCopy(error)
      this.setData({ errorMessage: result.message })
      if (result.refresh) await this.loadPage(false)
    } finally {
      this.setData({ mutating: false })
    }
  },

  confirmTransition(kind: 'OPEN' | 'CLOSE'): Promise<boolean> {
    return new Promise((resolve) => wx.showModal({
      title: kind === 'OPEN' ? '开放赛季报名？' : '关闭赛季报名？',
      content: kind === 'OPEN' ? '开放后赛季核心规则将锁定，并生成续赛邀请。' : '关闭后不再接受报名，将进入分组确认阶段。',
      confirmText: kind === 'OPEN' ? '确认开放' : '确认关闭',
      success: ({ confirm }) => resolve(confirm), fail: () => resolve(false),
    }))
  },

  onFilterTap(event: FilterTapEvent) {
    const filter = event.currentTarget.dataset.filter
    if (!filter) return
    this.setData({ activeFilter: filter })
    this.applyEntries(this.data.entries)
  },

  async approveEntry(event: EntryTapEvent) {
    await this.reviewEntry(event.currentTarget.dataset.id, 'approve')
  },

  async rejectEntry(event: EntryTapEvent) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    const reason = await this.requestRejectionReason()
    if (!reason) return
    await this.reviewEntry(id, 'reject', reason)
  },

  async reviewEntry(id: string | undefined, decision: 'approve' | 'reject', reason?: string) {
    if (!id || this.data.mutating) return
    const season = this.data.selectedSeason
    const entry = this.data.entries.find((item) => item.id === id)
    if (!season?.capabilities.canReviewEntries || !entry) return
    this.setData({ mutating: true, errorMessage: '' })
    try {
      await leaguesApi.reviewEntry(season.id, entry.id, decision, entry.version, reason)
      await this.loadEntries()
      wx.showToast({ title: decision === 'approve' ? '报名已通过' : '报名已拒绝', icon: 'success' })
    } catch (error) {
      const result = this.errorCopy(error)
      this.setData({ errorMessage: result.message })
      if (result.refresh) await this.loadPage(false)
    } finally {
      this.setData({ mutating: false })
    }
  },

  requestRejectionReason(): Promise<string | null> {
    return new Promise((resolve) => wx.showModal({
      title: '填写拒绝原因', editable: true, placeholderText: '原因会展示给报名者', confirmText: '确认拒绝',
      success: (result) => {
        const reason = result.content?.trim() ?? ''
        if (result.confirm && isRejectionReasonValid(reason)) resolve(reason)
        else {
          if (result.confirm) wx.showToast({ title: '请填写拒绝原因', icon: 'none' })
          resolve(null)
        }
      },
      fail: () => resolve(null),
    }))
  },

  editLeague() {
    if (this.data.league?.capabilities.canManage) wx.navigateTo({ url: `/pages/league-editor/index?id=${encodeURIComponent(this.data.leagueId)}` })
  },

  errorCopy(error: unknown) {
    return seasonManagerErrorMessage(error instanceof ApiError ? error.code : 'UNKNOWN')
  },
})
