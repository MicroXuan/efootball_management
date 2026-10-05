import type { PlayerCardDetail } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { catalogApi } from '../../services/catalog'
import { favoritesApi } from '../../services/favorites'
import { session } from '../../services/session'
import {
  automaticBuildPanelState,
  favoriteMutationState,
  favoritePlayerId,
  playerCardDetailWithAutomaticBuild,
  playerCardPresentation,
  toCardDetailViewModel,
  type PlayerCardDetailViewModel,
  type PlayerCardPresentation,
} from './detail.viewmodel'

type DetailOptions = { id?: string }
type SiblingTapEvent = { currentTarget: { dataset: { id?: string } } }

let detailRequestToken = 0
let detailUnloaded = false
let currentDetail: PlayerCardDetail | null = null

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error' | 'unavailable',
    errorMessage: '',
    cardId: '',
    card: null as PlayerCardDetailViewModel | null,
    presentation: null as PlayerCardPresentation | null,
    autoApplied: false,
    buildPanel: automaticBuildPanelState(false, false),
    isFavorite: false,
    favoriteBusy: false,
  },

  onLoad(options: DetailOptions) {
    detailUnloaded = false
    const id = options.id ? decodeURIComponent(options.id) : ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      this.setData({ state: 'unavailable', errorMessage: '球员卡编号无效' })
      return
    }
    this.setData({ cardId: id })
    void this.loadCard()
  },

  onUnload() {
    detailUnloaded = true
    currentDetail = null
    detailRequestToken += 1
  },

  retry() {
    void this.loadCard()
  },

  goBack() {
    wx.navigateBack()
  },

  onSiblingTap(event: SiblingTapEvent) {
    const id = event.currentTarget.dataset.id
    if (id) wx.redirectTo({ url: `/pages/player-card-detail/index?id=${encodeURIComponent(id)}` })
  },

  toggleAutomaticBuild() {
    if (!currentDetail || !this.data.card) return
    if (!this.data.card.autoBuild.available) {
      wx.showToast({ title: this.data.card.autoBuild.unavailableReason, icon: 'none' })
      return
    }
    const autoApplied = !this.data.autoApplied
    const presentation = playerCardPresentation(currentDetail, autoApplied)
    const buildPanel = automaticBuildPanelState(this.data.card.autoBuild.available, autoApplied)
    this.setData({ autoApplied, presentation, buildPanel })
  },

  async toggleFavorite() {
    const card = this.data.card
    if (!card || this.data.favoriteBusy) return
    if (!session.getAccessToken()) {
      wx.navigateTo({ url: '/pages/login/index' })
      return
    }
    const playerId = favoritePlayerId(card)
    const next = !this.data.isFavorite
    this.setData({ favoriteBusy: true })
    try {
      if (next) await favoritesApi.favorite(playerId)
      else await favoritesApi.unfavorite(playerId)
      this.setData({ isFavorite: favoriteMutationState(this.data.isFavorite, true, next) })
      wx.showToast({ title: next ? '已加入收藏' : '已取消收藏', icon: 'success' })
    } catch {
      this.setData({ isFavorite: favoriteMutationState(this.data.isFavorite, false, next) })
      wx.showToast({ title: '收藏操作失败，请重试', icon: 'none' })
    } finally {
      this.setData({ favoriteBusy: false })
    }
  },

  async loadCard() {
    const token = ++detailRequestToken
    this.setData({ state: 'loading', errorMessage: '' })
    try {
      const detail = await catalogApi.getPlayerCard(this.data.cardId)
      if (detailUnloaded || token !== detailRequestToken) return
      const presentationDetail = playerCardDetailWithAutomaticBuild(detail)
      const card = toCardDetailViewModel(presentationDetail)
      currentDetail = presentationDetail
      this.setData({
        state: 'loaded',
        card,
        autoApplied: false,
        buildPanel: automaticBuildPanelState(card.autoBuild.available, false),
        presentation: playerCardPresentation(presentationDetail, false),
      })
      void this.loadFavoriteStatus(card.playerId)
    } catch (error) {
      if (detailUnloaded || token !== detailRequestToken) return
      if (error instanceof ApiError && error.statusCode === 404) {
        this.setData({ state: 'unavailable', errorMessage: '这张球员卡未发布或已下架' })
      } else {
        this.setData({
          state: 'error',
          errorMessage: error instanceof ApiError ? error.message : '详情加载失败，请检查网络后重试',
        })
      }
    }
  },

  async loadFavoriteStatus(playerId: string) {
    if (!session.getAccessToken()) return
    try {
      const response = await favoritesApi.statuses([playerId])
      if (!detailUnloaded) this.setData({ isFavorite: response.favoritePlayerIds.includes(playerId) })
    } catch {
      // 收藏状态不阻断公开卡片详情。
    }
  },
})
