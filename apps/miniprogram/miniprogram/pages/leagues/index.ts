import type { LeagueSummary, MyLeagueTeamSummary } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { leaguesApi } from '../../services/leagues'
import { platformPresentationApi } from '../../services/platform-presentation'
import { session } from '../../services/session'
import { resolveImageSource } from '../../services/image-source'
import {
  leagueCardView,
  leagueBannerView,
  leagueEntryAction,
  leagueListErrorMessage,
  myLeagueCardView,
  selectLeagueCards,
  type LeagueCardView,
  type LeagueListTab,
} from './leagues.viewmodel'

type LeagueTapEvent = { currentTarget: { dataset: { id?: string } } }
type TabTapEvent = { currentTarget: { dataset: { tab?: LeagueListTab } } }

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    activeTab: 'all' as LeagueListTab,
    allLeagues: [] as LeagueCardView[],
    myLeagues: [] as LeagueCardView[],
    leagues: [] as LeagueCardView[],
    hasLeagues: false,
    loggedIn: false,
    bannerUrl: '',
    bannerDisplayUrl: '',
    bannerFailed: false,
    bannerVisible: true,
  },

  onShow() {
    this.setData({ bannerVisible: true })
    this.getTabBar?.()?.setData({ selected: 1 })
    void this.loadLeagues()
  },

  onHide() {
    this.setData({ bannerVisible: false })
  },

  onPullDownRefresh() {
    void this.loadLeagues(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadLeagues(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      const loggedIn = Boolean(session.getAccessToken())
      const [allResponse, mineResponse, presentation] = await Promise.all([
        leaguesApi.list(undefined, 100),
        loggedIn ? leaguesApi.mine() : Promise.resolve({ items: [], nextCursor: null }),
        platformPresentationApi.get().catch(() => ({ leagueCenterBannerUrl: null, version: 0 })),
      ])
      const banner = leagueBannerView(presentation)
      const bannerDisplayUrl = banner.imageUrl
        ? await resolveImageSource(banner.imageUrl, (options) => wx.downloadFile(options)).catch(() => '')
        : ''
      const allLeagues = allResponse.items.map((league: LeagueSummary) => leagueCardView(league))
      const myLeagues = mineResponse.items.map((team: MyLeagueTeamSummary) => myLeagueCardView(team))
      const leagues = selectLeagueCards(this.data.activeTab, allLeagues, myLeagues)
      this.setData({
        state: 'loaded', errorMessage: '', loggedIn, allLeagues, myLeagues, leagues,
        hasLeagues: leagues.length > 0, bannerUrl: banner.imageUrl, bannerDisplayUrl,
        bannerFailed: Boolean(banner.imageUrl && !bannerDisplayUrl),
      })
    } catch (error) {
      this.setData({
        state: 'error',
        errorMessage: error instanceof ApiError
          ? leagueListErrorMessage(error.code)
          : leagueListErrorMessage('UNKNOWN'),
      })
    }
  },

  onBannerError() {
    this.setData({ bannerFailed: true })
  },

  switchTab(event: TabTapEvent) {
    const activeTab = event.currentTarget.dataset.tab
    if (!activeTab || activeTab === this.data.activeTab) return
    const leagues = selectLeagueCards(activeTab, this.data.allLeagues, this.data.myLeagues)
    this.setData({ activeTab, leagues, hasLeagues: leagues.length > 0 })
  },

  openLeague(event: LeagueTapEvent) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    if (leagueEntryAction(id, this.data.myLeagues) === 'unbound') {
      void wx.showModal({
        title: '未绑定联赛',
        content: '您尚未绑定该联赛，请联系联赛管理员进行绑定',
        showCancel: false,
        confirmText: '确定',
      })
      return
    }
    wx.navigateTo({ url: `/pages/league-detail/index?id=${encodeURIComponent(id)}` })
  },
})
