import type { PlayerCardType, PlayerPosition, PlayerSearchResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { catalogApi } from '../../services/catalog'
import {
  cardTypeOptions,
  groupCardsByPack,
  isLatestPlayerRequest,
  nextPlayerPageState,
  positionOptions,
  toPackOptions,
  type PlayerCardGroup,
  type PlayerPageState,
  type PlayerQueryInput,
} from './players.viewmodel'

type InputEvent = { detail: { value: string } }
type CardTapEvent = { detail: { id?: string } }
type PickerEvent = { detail: { value: string } }

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
    positionIndex: 0,
    cardType: '' as '' | PlayerCardType,
    typeIndex: 0,
    cardPackId: '',
    packIndex: 0,
    packOptions: [{ value: '', label: '球员包' }],
    packErrorMessage: '',
    minOverall: '' as '' | number,
    cards: [] as PlayerPageState['cards'],
    groups: [] as PlayerCardGroup[],
    nextCursor: null as string | null,
    hasMore: true,
    positionOptions,
    typeOptions: cardTypeOptions,
  },

  onLoad() {
    unloaded = false
    void this.loadPacks()
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

  onPositionChange(event: PickerEvent) {
    const positionIndex = Number(event.detail.value)
    const option = this.data.positionOptions[positionIndex] ?? this.data.positionOptions[0]
    this.setData({ positionIndex, position: option?.value ?? '' })
    void this.loadCards('refresh')
  },

  onTypeChange(event: PickerEvent) {
    const typeIndex = Number(event.detail.value)
    const option = this.data.typeOptions[typeIndex] ?? this.data.typeOptions[0]
    this.setData({ typeIndex, cardType: option?.value ?? '' })
    void this.loadCards('refresh')
  },

  onPackChange(event: PickerEvent) {
    const packIndex = Number(event.detail.value)
    const option = this.data.packOptions[packIndex] ?? this.data.packOptions[0]
    this.setData({ packIndex, cardPackId: option?.value ?? '' })
    void this.loadCards('refresh')
  },

  resetFilters() {
    this.setData({ positionIndex: 0, position: '', typeIndex: 0, cardType: '', packIndex: 0, cardPackId: '' })
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
        groups: groupCardsByPack(next.cards),
        nextCursor: next.nextCursor,
        hasMore: next.hasMore,
        errorMessage: '',
      })
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
})
