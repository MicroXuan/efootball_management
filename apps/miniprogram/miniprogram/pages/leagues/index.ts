import type { LeagueSummary, MyLeagueTeamSummary } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { leaguesApi } from '../../services/leagues'
import { platformPresentationApi } from '../../services/platform-presentation'
import { session } from '../../services/session'
import { cacheImageSource } from '../../services/image-source'
import { clearBannerBeforeTabSwitch } from './banner-transition'
import { consumeMyLeaguesTabRequest } from './league-list-navigation'
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
type BannerMode = 'loading' | 'image' | 'fallback'

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
    bannerMode: 'loading' as BannerMode,
    bannerLayerVisible: true,
  },

  onShow() {
    const showMine = consumeMyLeaguesTabRequest()
    this.setData({
      bannerLayerVisible: true,
      ...(showMine ? {
        activeTab: 'mine' as LeagueListTab,
        leagues: selectLeagueCards('mine', this.data.allLeagues, this.data.myLeagues),
        hasLeagues: this.data.myLeagues.length > 0,
      } : {}),
    })
    this.getTabBar?.()?.setData({ selected: 1 })
    void this.loadLeagues(this.data.state !== 'loaded')
  },

  beforeTabLeave(continueSwitch: () => void) {
    clearBannerBeforeTabSwitch({
      clear: (done) => this.setData({ bannerLayerVisible: false }, done),
      nextTick: (done) => wx.nextTick(done),
      schedule: (done, delayMs) => setTimeout(done, delayMs),
      continueSwitch,
    })
  },

  onPullDownRefresh() {
    void this.loadLeagues(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadLeagues(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    const presentationPromise = platformPresentationApi.get().catch(() => null)
    try {
      const loggedIn = Boolean(session.getAccessToken())
      const [allResponse, mineResponse] = await Promise.all([
        leaguesApi.list(undefined, 100),
        loggedIn ? leaguesApi.mine() : Promise.resolve({ items: [], nextCursor: null }),
      ])
      const allLeagues = allResponse.items.map((league: LeagueSummary) => leagueCardView(league))
      const myLeagues = mineResponse.items.map((team: MyLeagueTeamSummary) => myLeagueCardView(team))
      const leagues = selectLeagueCards(this.data.activeTab, allLeagues, myLeagues)
      this.setData({
        state: 'loaded', errorMessage: '', loggedIn, allLeagues, myLeagues, leagues,
        hasLeagues: leagues.length > 0,
      })
      const presentation = await presentationPromise
      if (!presentation) {
        if (this.data.bannerMode === 'loading') this.setData({ bannerMode: 'fallback' })
        return
      }
      const banner = leagueBannerView(presentation)
      const previousBannerUrl = this.data.bannerUrl
      if (!banner.imageUrl) {
        this.setData({ bannerUrl: '', bannerDisplayUrl: '', bannerMode: 'fallback' })
        return
      }
      const preloadedSource = await cacheImageSource(
        banner.cacheSource,
        {
          downloadHttp: (options) => wx.downloadFile(options),
          downloadCloud: (options) => wx.cloud.downloadFile(options),
        },
        `${banner.cacheSource}:${presentation.version}`,
      ).catch(() => '')
      this.setData(preloadedSource
        ? { bannerUrl: banner.imageUrl, bannerDisplayUrl: banner.imageUrl, bannerMode: 'image' }
        : previousBannerUrl === banner.imageUrl && this.data.bannerDisplayUrl
          ? { bannerUrl: banner.imageUrl }
          : { bannerUrl: banner.imageUrl, bannerDisplayUrl: '', bannerMode: 'fallback' })
    } catch (error) {
      this.setData({
        state: this.data.state === 'loaded' ? 'loaded' : 'error',
        errorMessage: error instanceof ApiError
          ? leagueListErrorMessage(error.code)
          : leagueListErrorMessage('UNKNOWN'),
      })
    }
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
