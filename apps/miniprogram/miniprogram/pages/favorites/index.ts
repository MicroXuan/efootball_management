import type { PlayerFavoriteListQuery } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { favoritesApi } from '../../services/favorites'
import { session } from '../../services/session'
import {
  buildFavoriteQuery,
  favoritePageCopy,
  nextFavoritePageState,
  type FavoritePageState,
} from './favorites.viewmodel'

type InputEvent = { detail: { value: string } }
type CardTapEvent = { detail: { id?: string } }
type PlayerTapEvent = { currentTarget: { dataset: { playerId?: string } } }

let searchTimer: ReturnType<typeof setTimeout> | undefined
let requestToken = 0
let unloaded = false

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    keyword: '',
    items: [] as FavoritePageState['items'],
    cards: [] as FavoritePageState['cards'],
    nextCursor: null as string | null,
    hasMore: true,
    loadingMore: false,
    emptyCopy: favoritePageCopy('empty'),
    errorCopy: favoritePageCopy('error'),
  },

  onLoad() {
    unloaded = false
    if (!session.getAccessToken()) {
      wx.redirectTo({ url: '/pages/login/index' })
      return
    }
    void this.loadFavorites('refresh')
  },

  onUnload() {
    unloaded = true
    requestToken += 1
    if (searchTimer) clearTimeout(searchTimer)
  },

  onPullDownRefresh() {
    void this.loadFavorites('refresh').finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.loadingMore || !this.data.hasMore) return
    void this.loadFavorites('append')
  },

  onKeywordInput(event: InputEvent) {
    this.setData({ keyword: event.detail.value })
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void this.loadFavorites('refresh'), 300)
  },

  onCardTap(event: CardTapEvent) {
    const id = event.detail.id
    if (id) wx.navigateTo({ url: `/pages/player-card-detail/index?id=${encodeURIComponent(id)}` })
  },

  async onRemoveFavorite(event: PlayerTapEvent) {
    const playerId = event.currentTarget.dataset.playerId
    if (!playerId) return
    try {
      await favoritesApi.unfavorite(playerId)
      const items = this.data.items.filter((item) => item.playerId !== playerId)
      this.setData({
        items,
        cards: this.data.cards.filter((card) => card.playerId !== playerId),
      })
      wx.showToast({ title: '已取消收藏', icon: 'success' })
    } catch {
      wx.showToast({ title: '取消收藏失败，请重试', icon: 'none' })
    }
  },

  retry() {
    void this.loadFavorites('refresh')
  },

  async loadFavorites(mode: 'refresh' | 'append') {
    const token = ++requestToken
    this.setData(mode === 'append'
      ? { loadingMore: true, errorMessage: '' }
      : { state: 'loading', errorMessage: '', nextCursor: null, hasMore: true })
    const query = buildFavoriteQuery({
      keyword: this.data.keyword,
      cursor: mode === 'append' ? this.data.nextCursor ?? undefined : undefined,
      limit: 20,
    } satisfies PlayerFavoriteListQuery, mode === 'refresh')
    try {
      const response = await favoritesApi.list(query)
      if (unloaded || token !== requestToken) return
      const next = nextFavoritePageState({
        items: this.data.items,
        cards: this.data.cards,
        nextCursor: this.data.nextCursor,
        hasMore: this.data.hasMore,
        errorMessage: this.data.errorMessage,
      }, response, mode)
      this.setData({ state: 'loaded', ...next })
    } catch (error) {
      if (unloaded || token !== requestToken) return
      if (error instanceof ApiError && error.statusCode === 401) {
        wx.redirectTo({ url: '/pages/login/index' })
        return
      }
      this.setData({
        state: mode === 'append' ? 'loaded' : 'error',
        errorMessage: error instanceof ApiError ? error.message : favoritePageCopy('error').detail,
      })
    } finally {
      if (!unloaded && token === requestToken) this.setData({ loadingMore: false })
    }
  },
})
