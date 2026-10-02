import type { LeagueDetail, LeagueSeasonSummary, LeagueTeamSummary, SeasonEntryResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { leaguesApi } from '../../services/leagues'
import { leagueTeamsApi } from '../../services/league-teams'
import { session } from '../../services/session'
import {
  entryStatusCopy,
  leagueDetailErrorMessage,
  seasonRailSteps,
  seasonStructureCopy,
  selectSeason,
  type SeasonRailStep,
} from './detail.viewmodel'
import { seasonStatusLabel, seasonStatusTone } from '../leagues/leagues.viewmodel'

type LoadOptions = { id?: string }
type SeasonPickerEvent = { detail: { value: string } }

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
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
    profile: null as LeagueTeamSummary | null,
    entry: null as SeasonEntryResponse | null,
    entryStatus: '',
    seasonRail: [] as SeasonRailStep[],
    seasonStatusLabel: '',
    seasonStatusTone: 'muted' as 'accent' | 'info' | 'warning' | 'muted' | 'danger',
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
      const [league, seasons, profile] = await Promise.all([
        this.loadLeague(),
        leaguesApi.seasons(this.data.leagueId),
        loggedIn ? leagueTeamsApi.mine().then((result) => result.items.find((team) => team.leagueId === this.data.leagueId) ?? null) : Promise.resolve(null),
      ])
      const selectedSeason = selectSeason(seasons, this.data.selectedSeason?.id)
      this.setData({
        state: 'loaded', errorMessage: '', league, seasons, loggedIn,
        seasonLabels: seasons.map((season) => season.displayName),
        selectedSeasonIndex: Math.max(0, seasons.findIndex((season) => season.id === selectedSeason?.id)),
        selectedSeason,
        structureCopy: selectedSeason ? seasonStructureCopy(selectedSeason) : '',
        registrationCloseDate: selectedSeason?.registrationClosesAt.slice(0, 10) ?? '',
        leagueLogoText: league.shortName.slice(0, 2),
        profile,
        entryStatus: entryStatusCopy(loggedIn, Boolean(profile), null),
        seasonRail: selectedSeason ? seasonRailSteps(selectedSeason.status) : [],
        seasonStatusLabel: selectedSeason ? seasonStatusLabel(selectedSeason.status) : '',
        seasonStatusTone: seasonStatusTone(selectedSeason?.status ?? null),
      })
      await this.loadEntry()
    } catch (error) {
      this.setData({ state: 'error', errorMessage: this.errorCopy(error) })
    }
  },

  async loadLeague(): Promise<LeagueDetail> {
    return leaguesApi.detail(this.data.leagueId)
  },

  async loadEntry() {
    const season = this.data.selectedSeason
    if (!season) {
      this.setData({ entry: null, entryStatus: entryStatusCopy(this.data.loggedIn, Boolean(this.data.profile), null) })
      return
    }
    if (!this.data.loggedIn) {
      this.setData({ entry: null, entryStatus: entryStatusCopy(false, false, null) })
      return
    }
    const entry = await leaguesApi.myEntry(season.id)
    this.setData({ entry, entryStatus: entryStatusCopy(true, Boolean(this.data.profile), entry) })
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
      entryStatus: entryStatusCopy(this.data.loggedIn, Boolean(this.data.profile), null),
      seasonRail: seasonRailSteps(selectedSeason.status),
      seasonStatusLabel: seasonStatusLabel(selectedSeason.status),
      seasonStatusTone: seasonStatusTone(selectedSeason.status),
    })
    void this.loadEntry().catch((error: unknown) => this.setData({ errorMessage: this.errorCopy(error) }))
  },

  enterCurrentSeason() {
    wx.pageScrollTo({ selector: '#current-season', duration: 180 })
  },

  errorCopy(error: unknown): string {
    return error instanceof ApiError ? leagueDetailErrorMessage(error.code) : leagueDetailErrorMessage('UNKNOWN')
  },
})
