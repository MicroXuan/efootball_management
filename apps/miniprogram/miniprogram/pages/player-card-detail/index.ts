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

Page({
  detailRequestToken: 0,
  detailUnloaded: false,
  requestInFlight: false,
  currentDetail: null as PlayerCardDetail | null,

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
    this.detailUnloaded = false
    this.requestInFlight = false
    this.detailRequestToken = 0
    this.currentDetail = null
    const id = options.id ? decodeURIComponent(options.id) : ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      this.setData({ state: 'unavailable', errorMessage: '球员卡编号无效' })
      return
    }
    this.setData({ cardId: id })
    this.resumeAuthenticatedDetail()
  },

  onShow() {
    if (this.data.state === 'loaded' && this.data.card) {
      void this.loadFavoriteStatus(this.data.card.playerId)
      return
    }
    this.resumeAuthenticatedDetail()
  },

  onUnload() {
    this.detailUnloaded = true
    this.currentDetail = null
    this.detailRequestToken += 1
  },

  retry() {
    void this.loadCard()
  },

  goBack() {
    wx.navigateBack()
  },

  goToLogin() {
    const route = `/pages/player-card-detail/index?id=${encodeURIComponent(this.data.cardId)}`
    wx.navigateTo({ url: `/pages/login/index?redirect=${encodeURIComponent(route)}` })
  },

  resumeAuthenticatedDetail() {
    if (!this.data.cardId || this.data.state === 'loaded' || this.requestInFlight) return
    void this.loadCard()
  },

  onSiblingTap(event: SiblingTapEvent) {
    const id = event.currentTarget.dataset.id
    if (id) wx.redirectTo({ url: `/pages/player-card-detail/index?id=${encodeURIComponent(id)}` })
  },

  toggleAutomaticBuild() {
    if (!this.currentDetail || !this.data.card) return
    if (!this.data.card.autoBuild.available) {
      wx.showToast({ title: this.data.card.autoBuild.unavailableReason, icon: 'none' })
      return
    }
    const autoApplied = !this.data.autoApplied
    const presentation = playerCardPresentation(this.currentDetail, autoApplied)
    const buildPanel = automaticBuildPanelState(this.data.card.autoBuild.available, autoApplied)
    this.setData({ autoApplied, presentation, buildPanel })
  },

  async toggleFavorite() {
    const card = this.data.card
    if (!card || this.data.favoriteBusy) return
    if (!session.getAccessToken()) {
      this.goToLogin()
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
    const token = ++this.detailRequestToken
    this.requestInFlight = true
    this.setData({ state: 'loading', errorMessage: '' })
    try {
      const detail = await catalogApi.getPlayerCard(this.data.cardId)
      if (this.detailUnloaded || token !== this.detailRequestToken) return
      const presentationDetail = playerCardDetailWithAutomaticBuild(detail)
      const card = toCardDetailViewModel(presentationDetail)
      this.currentDetail = presentationDetail
      this.setData({
        state: 'loaded',
        card,
        autoApplied: false,
        buildPanel: automaticBuildPanelState(card.autoBuild.available, false),
        presentation: playerCardPresentation(presentationDetail, false),
      })
      void this.loadFavoriteStatus(card.playerId)
    } catch (error) {
      if (this.detailUnloaded || token !== this.detailRequestToken) return
      if (error instanceof ApiError && error.statusCode === 404) {
        this.setData({ state: 'unavailable', errorMessage: '这张球员卡未发布或已下架' })
      } else {
        this.setData({
          state: 'error',
          errorMessage: error instanceof ApiError ? error.message : '详情加载失败，请检查网络后重试',
        })
      }
    } finally {
      if (token === this.detailRequestToken) this.requestInFlight = false
    }
  },

  async loadFavoriteStatus(playerId: string) {
    if (!session.getAccessToken()) return
    const token = this.detailRequestToken
    try {
      const response = await favoritesApi.statuses([playerId])
      if (!this.detailUnloaded && token === this.detailRequestToken) this.setData({ isFavorite: response.favoritePlayerIds.includes(playerId) })
    } catch {
      // 收藏状态不阻断公开卡片详情。
    }
  },
})
