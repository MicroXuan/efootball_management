import type { PlayerCardType, PlayerPosition, PlayerSearchResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { catalogApi } from '../../services/catalog'
import {
  nextPlayerPageState,
  type PlayerCardGroup,
  type PlayerPageState,
  type PlayerQueryInput,
} from './players.viewmodel'

type InputEvent = { detail: { value: string } }
type FilterTapEvent = { currentTarget: { dataset: { value?: string } } }
type CardTapEvent = { detail: { id?: string } }

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
    void this.loadCards('refresh')
  },

  onShow() {
    this.getTabBar?.()?.setData({ selected: 0 })
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
      minOverall: this.data.minOverall || undefined,
      cursor: mode === 'append' ? this.data.nextCursor ?? undefined : undefined,
      limit: 20,
    }
    try {
      const response: PlayerSearchResponse = await catalogApi.searchPlayers(query)
      if (unloaded || token !== requestToken) return
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
        groups: next.groups,
        nextCursor: next.nextCursor,
        hasMore: next.hasMore,
        errorMessage: '',
      })
    } catch (error) {
      if (unloaded || token !== requestToken) return
      this.setData({ errorMessage: errorMessage(error) })
    } finally {
      if (!unloaded && token === requestToken) this.setData({ loading: false, loadingMore: false })
    }
  },
})
