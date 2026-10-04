import type { PlayerCardType, PlayerPosition, PlayerSearchResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { catalogApi } from '../../services/catalog'
import { favoritesApi } from '../../services/favorites'
import { session } from '../../services/session'
import {
  favoriteLookup,
  groupCardsByPack,
  isLatestPlayerRequest,
  nextPlayerPageState,
  toPackOptions,
  type PlayerCardGroup,
  type PlayerPageState,
  type PlayerQueryInput,
} from './players.viewmodel'

type InputEvent = { detail: { value: string } }
type FilterTapEvent = { currentTarget: { dataset: { value?: string } } }
type CardTapEvent = { detail: { id?: string } }
type PickerEvent = { detail: { value: string } }
type FavoriteTapEvent = { currentTarget: { dataset: { playerId?: string } } }

let searchTimer: ReturnType<typeof setTimeout> | undefined
let requestToken = 0
let unloaded = false

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '球员数据加载失败，请检查网络后重试'
}

Page({
  data: {
    loading: true,
    refreshing: false,
    loadingMore: false,
    errorMessage: '',
    keyword: '',
    position: '' as '' | PlayerPosition,
    cardType: '' as '' | PlayerCardType,
    cardPackId: '',
    packIndex: 0,
    packOptions: [{ value: '', label: '全部球员包' }],
    packErrorMessage: '',
    favoritePlayerIds: {} as Record<string, boolean>,
    minOverall: '' as '' | number,
    cards: [] as PlayerPageState['cards'],
    groups: [] as PlayerCardGroup[],
    nextCursor: null as string | null,
    hasMore: true,
    positionFilters: [
      { value: '', label: '全部位置' },
      { value: 'GK', label: '门将' },
      { value: 'CB', label: '中后卫' },
      { value: 'DMF', label: '后腰' },
      { value: 'CMF', label: '中前卫' },
      { value: 'AMF', label: '前腰' },
      { value: 'LWF', label: '左边锋' },
      { value: 'RWF', label: '右边锋' },
      { value: 'SS', label: '影锋' },
      { value: 'CF', label: '中锋' },
    ],
    typeFilters: [
      { value: '', label: '全部卡种' },
      { value: 'STANDARD', label: '基础卡' },
      { value: 'FEATURED', label: '精选' },
      { value: 'TRENDING', label: '状态火热' },
      { value: 'HIGHLIGHT', label: '高光' },
      { value: 'EPIC', label: '史诗' },
      { value: 'BIG_TIME', label: '时刻' },
    ],
  },

  onLoad() {
    unloaded = false
    void this.loadPacks()
    void this.loadCards('refresh')
  },

  onShow() {
    this.getTabBar?.()?.setData({ selected: 0 })
    if (this.data.cards.length) void this.loadFavoriteStatuses(this.data.cards)
  },

  onUnload() {
    unloaded = true
    requestToken += 1
    if (searchTimer) clearTimeout(searchTimer)
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true })
    void this.loadCards('refresh').finally(() => {
      if (!unloaded) this.setData({ refreshing: false })
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    if (this.data.loadingMore || !this.data.hasMore) return
    void this.loadCards('append')
  },

  onKeywordInput(event: InputEvent) {
    const keyword = event.detail.value
    this.setData({ keyword })
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void this.loadCards('refresh'), 300)
  },

  onPositionTap(event: FilterTapEvent) {
    this.setData({ position: (event.currentTarget.dataset.value ?? '') as '' | PlayerPosition })
    void this.loadCards('refresh')
  },

  onTypeTap(event: FilterTapEvent) {
    this.setData({ cardType: (event.currentTarget.dataset.value ?? '') as '' | PlayerCardType })
    void this.loadCards('refresh')
  },

  onPackChange(event: PickerEvent) {
    const packIndex = Number(event.detail.value)
    const option = this.data.packOptions[packIndex] ?? this.data.packOptions[0]
    this.setData({ packIndex, cardPackId: option?.value ?? '' })
    void this.loadCards('refresh')
  },

  async onFavoriteTap(event: FavoriteTapEvent) {
    const playerId = event.currentTarget.dataset.playerId
    if (!playerId) return
    if (!session.getAccessToken()) {
      wx.navigateTo({ url: '/pages/login/index' })
      return
    }
    const wasFavorite = this.data.favoritePlayerIds[playerId] === true
    try {
      if (wasFavorite) await favoritesApi.unfavorite(playerId)
      else await favoritesApi.favorite(playerId)
      const favoritePlayerIds = { ...this.data.favoritePlayerIds, [playerId]: !wasFavorite }
      this.setData({
        favoritePlayerIds,
        groups: groupCardsByPack(this.data.cards, favoritePlayerIds),
      })
      wx.showToast({ title: wasFavorite ? '已取消收藏' : '已加入收藏', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none' })
    }
  },

  retry() {
    void this.loadCards('refresh')
  },

  onCardTap(event: CardTapEvent) {
    const id = event.detail.id
    if (id) wx.navigateTo({ url: `/pages/player-card-detail/index?id=${encodeURIComponent(id)}` })
  },

  async loadCards(mode: 'refresh' | 'append') {
    const token = ++requestToken
    this.setData(mode === 'append'
      ? { loadingMore: true, errorMessage: '' }
      : { loading: true, errorMessage: '', nextCursor: null, hasMore: true })
    const query: PlayerQueryInput = {
      keyword: this.data.keyword.trim() || undefined,
      position: this.data.position || undefined,
      cardType: this.data.cardType || undefined,
      cardPackId: this.data.cardPackId || undefined,
      minOverall: this.data.minOverall || undefined,
      cursor: mode === 'append' ? this.data.nextCursor ?? undefined : undefined,
      limit: 20,
    }
    try {
      const response: PlayerSearchResponse = await catalogApi.searchPlayers(query)
      if (!isLatestPlayerRequest(requestToken, token, unloaded)) return
      const next = nextPlayerPageState({
        cards: this.data.cards,
        groups: this.data.groups,
        nextCursor: this.data.nextCursor,
        hasMore: this.data.hasMore,
        releaseSequence: null,
        errorMessage: this.data.errorMessage,
      }, response, mode)
      this.setData({
        cards: next.cards,
        groups: groupCardsByPack(next.cards, this.data.favoritePlayerIds),
        nextCursor: next.nextCursor,
        hasMore: next.hasMore,
        errorMessage: '',
      })
      void this.loadFavoriteStatuses(next.cards)
    } catch (error) {
      if (!isLatestPlayerRequest(requestToken, token, unloaded)) return
      this.setData({ errorMessage: errorMessage(error) })
    } finally {
      if (isLatestPlayerRequest(requestToken, token, unloaded)) this.setData({ loading: false, loadingMore: false })
    }
  },

  async loadPacks() {
    try {
      const response = await catalogApi.listCardPacks({ limit: 100 })
      if (unloaded) return
      this.setData({ packOptions: toPackOptions(response.items), packErrorMessage: '' })
    } catch {
      if (!unloaded) this.setData({ packErrorMessage: '球员包加载失败，可稍后重试' })
    }
  },

  async loadFavoriteStatuses(cards: PlayerPageState['cards']) {
    if (!session.getAccessToken() || cards.length === 0) return
    const playerIds = [...new Set(cards.map(({ playerId }) => playerId))].slice(0, 100)
    try {
      const response = await favoritesApi.statuses(playerIds)
      if (unloaded) return
      const favoritePlayerIds = favoriteLookup(cards, response.favoritePlayerIds)
      this.setData({
        favoritePlayerIds,
        groups: groupCardsByPack(this.data.cards, favoritePlayerIds),
      })
    } catch {
      // 收藏状态不影响公共球员目录浏览。
    }
  },
})
