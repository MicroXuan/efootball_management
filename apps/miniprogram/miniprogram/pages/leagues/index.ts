import type { LeagueSummary } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { leaguesApi } from '../../services/leagues'
import { leagueCardView, leagueListErrorMessage, type LeagueCardView } from './leagues.viewmodel'

type LeagueTapEvent = { currentTarget: { dataset: { id?: string } } }

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    leagues: [] as LeagueCardView[],
    hasLeagues: false,
  },

  onLoad() {
    void this.loadLeagues()
  },

  onPullDownRefresh() {
    void this.loadLeagues(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadLeagues(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      const response = await leaguesApi.list(undefined, 100)
      const leagues = response.items.map((league: LeagueSummary) => leagueCardView(league))
      this.setData({ state: 'loaded', errorMessage: '', leagues, hasLeagues: leagues.length > 0 })
    } catch (error) {
      this.setData({
        state: 'error',
        errorMessage: error instanceof ApiError
          ? leagueListErrorMessage(error.code)
          : leagueListErrorMessage('UNKNOWN'),
      })
    }
  },

  openLeague(event: LeagueTapEvent) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/league-detail/index?id=${encodeURIComponent(id)}` })
  },
})
