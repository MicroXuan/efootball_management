import type { LeagueSeasonSummary } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import { leaguesApi } from '../../services/leagues'
import { competitionErrorMessage } from '../competitions/competitions.viewmodel'
import { matchCard, seasonOptions } from './matches.viewmodel'

type LoadOptions = { leagueId?: string; seasonId?: string }

Page({
  data: {
    loading: true,
    errorMessage: '',
    leagueId: '',
    seasonId: '',
    seasons: [] as LeagueSeasonSummary[],
    seasonChoices: [] as Array<{ id: string; label: string }>,
    seasonLabels: [] as string[],
    selectedSeasonIndex: 0,
    items: [] as Array<ReturnType<typeof matchCard>>
  },
  onLoad(options: LoadOptions) {
    this.setData({ leagueId: options.leagueId ?? '', seasonId: options.seasonId ?? '' })
    void this.load()
  },
  onShow() { if (!this.data.loading && this.data.items.length) void this.load(false) },
  onPullDownRefresh() { void this.load(false).finally(() => wx.stopPullDownRefresh()) },
  retry() { void this.load() },
  changeSeason(event: { detail: { value: string } }) {
    const selectedSeasonIndex = Number(event.detail.value)
    const seasonId = this.data.seasonChoices[selectedSeasonIndex]?.id
    if (!seasonId || seasonId === this.data.seasonId) return
    this.setData({ selectedSeasonIndex, seasonId, items: [] })
    void this.load()
  },
  async load(showLoading = true) {
    if (showLoading) this.setData({ loading: true, errorMessage: '' })
    try {
      let seasons = this.data.seasons
      if (this.data.leagueId && !seasons.length) seasons = await leaguesApi.seasons(this.data.leagueId)
      const choices = seasonOptions(seasons, this.data.seasonId)
      const seasonId = choices.selectedSeasonId || this.data.seasonId
      const response = await competitionsApi.myMatches({ limit: 100, seasonId: seasonId || undefined })
      this.setData({
        seasons,
        seasonChoices: choices.items,
        seasonLabels: choices.items.map(({ label }) => label),
        selectedSeasonIndex: choices.selectedIndex,
        seasonId,
        items: response.items.map(matchCard),
        errorMessage: ''
      })
    } catch (error) {
      this.setData({ errorMessage: competitionErrorMessage(error instanceof ApiError ? error : {}) })
    } finally {
      this.setData({ loading: false })
    }
  }
})
