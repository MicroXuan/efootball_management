import type { PlayerPosition } from '@efm/contracts'
import { ApiError } from '../../services/api'
import {
  listPlayerApplications,
  listPlayerMarket,
  listPlayerMarketAnnouncements,
} from '../../services/player-market'
import {
  announcementCard,
  applicationCard,
  marketPlayerCard,
  mergeMarketPlayerPages,
  shouldShowMarketBackToTop,
} from './player-market.viewmodel'

type MarketView = 'players' | 'public' | 'announcements' | 'mine'
type LoadOptions = { leagueId?: string; seasonId?: string; teamId?: string; view?: MarketView }
type DatasetEvent = { currentTarget: { dataset: { view?: MarketView; playerId?: string } } }
type InputEvent = { detail: { value: string } }
type PickerEvent = { detail: { value: string } }

const viewLabels = [
  { key: 'players', label: '找球员' },
  { key: 'public', label: '公开申请' },
  { key: 'announcements', label: '转会新闻' },
  { key: 'mine', label: '我的申请' },
] as const
const positions = [
  { value: '', label: '全部位置' }, { value: 'GK', label: '门将' }, { value: 'CB', label: '中卫' },
  { value: 'LB', label: '左后卫' }, { value: 'RB', label: '右后卫' }, { value: 'DMF', label: '后腰' },
  { value: 'CMF', label: '中场' }, { value: 'AMF', label: '前腰' }, { value: 'LWF', label: '左边锋' },
  { value: 'RWF', label: '右边锋' }, { value: 'SS', label: '影锋' }, { value: 'CF', label: '中锋' },
] as const
const ownerships = [
  { value: 'ALL', label: '全部归属' }, { value: 'FREE', label: '自由球员' }, { value: 'OWNED', label: '已有球队' },
] as const

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'empty' | 'error',
    errorMessage: '', leagueId: '', seasonId: '', teamId: '',
    view: 'players' as MarketView, viewLabels,
    keyword: '', positions, positionIndex: 0, ownerships, ownershipIndex: 0,
    players: [] as ReturnType<typeof marketPlayerCard>[],
    applications: [] as ReturnType<typeof applicationCard>[],
    announcements: [] as ReturnType<typeof announcementCard>[],
    nextPlayerCursor: null as string | null,
    nextAnnouncementCursor: null as string | null,
    nextApplicationCursor: null as string | null,
    loadingMore: false,
    showBackToTop: false,
  },

  onLoad(options: LoadOptions) {
    if (!options.leagueId || !options.seasonId || !options.teamId) {
      this.setData({ state: 'error', errorMessage: '球员市场参数缺失' })
      return
    }
    const view = viewLabels.some(({ key }) => key === options.view) ? options.view : 'players'
    this.setData({ leagueId: options.leagueId, seasonId: options.seasonId, teamId: options.teamId, view })
  },

  onShow() {
    if (this.data.leagueId) void this.loadView(this.data.state !== 'loaded' && this.data.state !== 'empty')
  },

  onPullDownRefresh() {
    void this.loadView(false).finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.loadingMore) return
    if (this.data.view === 'announcements' && this.data.nextAnnouncementCursor) {
      void this.loadView(false, 'append')
      return
    }
    if ((this.data.view === 'public' || this.data.view === 'mine') && this.data.nextApplicationCursor) {
      void this.loadView(false, 'append')
      return
    }
    if (this.data.view !== 'players' || !this.data.nextPlayerCursor) return
    void this.loadView(false, 'append')
  },

  onPageScroll(event: { scrollTop: number }) {
    const showBackToTop = shouldShowMarketBackToTop(event.scrollTop)
    if (showBackToTop !== this.data.showBackToTop) this.setData({ showBackToTop })
  },

  backToTop() {
    this.setData({ showBackToTop: false })
    wx.pageScrollTo({ scrollTop: 0, duration: 250 })
  },

  switchView(event: DatasetEvent) {
    const view = event.currentTarget.dataset.view
    if (!view || view === this.data.view) return
    this.setData({ view })
    void this.loadView()
  },

  onKeywordInput(event: InputEvent) {
    this.setData({ keyword: event.detail.value })
  },

  searchPlayers() {
    void this.loadView()
  },

  onPositionChange(event: PickerEvent) {
    this.setData({ positionIndex: Number(event.detail.value) })
    void this.loadView()
  },

  onOwnershipChange(event: PickerEvent) {
    this.setData({ ownershipIndex: Number(event.detail.value) })
    void this.loadView()
  },

  async loadView(showLoading = true, mode: 'replace' | 'append' = 'replace') {
    if (mode === 'append') this.setData({ loadingMore: true, errorMessage: '' })
    else if (showLoading) this.setData({ state: 'loading', errorMessage: '', nextPlayerCursor: null, nextAnnouncementCursor: null, nextApplicationCursor: null })
    try {
      let count = 0
      if (this.data.view === 'players') {
        const position = this.data.positions[this.data.positionIndex]?.value as PlayerPosition | ''
        const ownership = this.data.ownerships[this.data.ownershipIndex]?.value ?? 'ALL'
        const result = await listPlayerMarket(this.data.leagueId, {
          seasonId: this.data.seasonId,
          keyword: this.data.keyword.trim() || undefined,
          position: position || undefined,
          ownership,
          cursor: mode === 'append' ? this.data.nextPlayerCursor ?? undefined : undefined,
          limit: 30,
        })
        const players = mergeMarketPlayerPages(
          this.data.players,
          result.items.map(marketPlayerCard),
          mode,
        )
        count = players.length
        this.setData({ players, nextPlayerCursor: result.nextCursor })
      } else if (this.data.view === 'announcements') {
        const result = await listPlayerMarketAnnouncements(this.data.leagueId, {
          seasonId: this.data.seasonId, cursor: mode === 'append' ? this.data.nextAnnouncementCursor ?? undefined : undefined, limit: 30,
        })
        const existing = mode === 'append' ? this.data.announcements : []
        const seen = new Set(existing.map((item) => item.id))
        const announcements = [...existing, ...result.items.map(announcementCard).filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)))]
        count = announcements.length
        this.setData({ announcements, nextAnnouncementCursor: result.nextCursor })
      } else {
        const result = await listPlayerApplications(this.data.leagueId, {
          seasonId: this.data.seasonId,
          scope: this.data.view === 'mine' ? 'MINE' : 'PUBLIC',
          cursor: mode === 'append' ? this.data.nextApplicationCursor ?? undefined : undefined,
          limit: 30,
        })
        const existing = mode === 'append' ? this.data.applications : []
        const seen = new Set(existing.map((item) => item.id))
        const applications = [...existing, ...result.items.map(applicationCard).filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)))]
        count = applications.length
        this.setData({ applications, nextApplicationCursor: result.nextCursor })
      }
      this.setData({ state: count ? 'loaded' : 'empty', errorMessage: '' })
    } catch (error) {
      const errorMessage = error instanceof ApiError ? error.message : '球员市场加载失败，请稍后重试'
      this.setData(mode === 'append' || (!showLoading && this.data.state === 'loaded')
        ? { errorMessage }
        : { state: 'error', errorMessage })
    } finally {
      if (mode === 'append') this.setData({ loadingMore: false })
    }
  },

  openPlayer(event: DatasetEvent) {
    const playerId = event.currentTarget.dataset.playerId
    if (!playerId) return
    wx.navigateTo({ url: `/pages/player-market-detail/index?leagueId=${encodeURIComponent(this.data.leagueId)}&seasonId=${encodeURIComponent(this.data.seasonId)}&teamId=${encodeURIComponent(this.data.teamId)}&playerId=${encodeURIComponent(playerId)}` })
  },
})
