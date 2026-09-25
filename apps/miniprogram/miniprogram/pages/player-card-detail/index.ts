import { ApiError } from '../../services/api'
import { catalogApi } from '../../services/catalog'
import { toCardDetailViewModel, type PlayerCardDetailViewModel } from './detail.viewmodel'

type DetailOptions = { id?: string }
type SiblingTapEvent = { currentTarget: { dataset: { id?: string } } }

let detailRequestToken = 0
let detailUnloaded = false

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error' | 'unavailable',
    errorMessage: '',
    cardId: '',
    card: null as PlayerCardDetailViewModel | null,
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

  async loadCard() {
    const token = ++detailRequestToken
    this.setData({ state: 'loading', errorMessage: '' })
    try {
      const detail = await catalogApi.getPlayerCard(this.data.cardId)
      if (detailUnloaded || token !== detailRequestToken) return
      this.setData({ state: 'loaded', card: toCardDetailViewModel(detail) })
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
})
