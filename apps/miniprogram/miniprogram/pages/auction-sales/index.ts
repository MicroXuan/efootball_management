import type { MyPlayerAuctionSale } from '@efm/contracts'
import { listMyPlayerAuctionSales } from '../../services/player-auctions'
import { auctionSaleCardPath, auctionSaleRows, isLatestSalesRequest, mergeAuctionSales, shouldShowAuctionSalesBackToTop, type AuctionSalesState } from './auction-sales.viewmodel'

type InputEvent = { detail: { value: string } }
type CardTapEvent = { currentTarget: { dataset: { cardId?: string } } }
let searchTimer: ReturnType<typeof setTimeout> | undefined
let requestToken = 0
let unloaded = false

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    keyword: '', errorMessage: '', loadingMore: false,
    items: [] as ReturnType<typeof auctionSaleRows>,
    nextCursor: null as string | null, hasMore: true,
    showBackToTop: false,
  },

  onLoad() { unloaded = false; void this.loadSales('refresh') },
  onUnload() { unloaded = true; requestToken += 1; if (searchTimer) clearTimeout(searchTimer) },
  onPullDownRefresh() { void this.loadSales('refresh').finally(() => wx.stopPullDownRefresh()) },
  onReachBottom() { if (!this.data.loadingMore && this.data.hasMore) void this.loadSales('append') },
  onPageScroll(event: { scrollTop: number }) {
    const showBackToTop = shouldShowAuctionSalesBackToTop(event.scrollTop)
    if (showBackToTop !== this.data.showBackToTop) this.setData({ showBackToTop })
  },
  backToTop() {
    this.setData({ showBackToTop: false })
    wx.pageScrollTo({ scrollTop: 0, duration: 250 })
  },
  onKeywordInput(event: InputEvent) {
    this.setData({ keyword: event.detail.value })
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void this.loadSales('refresh'), 300)
  },
  retry() { void this.loadSales('refresh') },
  openCard(event: CardTapEvent) {
    const cardId = event.currentTarget.dataset.cardId
    if (cardId) wx.navigateTo({ url: auctionSaleCardPath(cardId) })
  },

  async loadSales(mode: 'refresh' | 'append') {
    const token = ++requestToken
    this.setData(mode === 'append' ? { loadingMore: true, errorMessage: '' } : { state: 'loading', errorMessage: '', nextCursor: null, hasMore: true })
    try {
      const response = await listMyPlayerAuctionSales({
        keyword: this.data.keyword.trim() || undefined,
        cursor: mode === 'append' ? this.data.nextCursor ?? undefined : undefined,
        limit: 30,
      })
      if (!isLatestSalesRequest(requestToken, token, unloaded)) return
      const previous: AuctionSalesState = { items: this.data.items as MyPlayerAuctionSale[], nextCursor: this.data.nextCursor, hasMore: this.data.hasMore }
      const next = mergeAuctionSales(previous, response, mode)
      this.setData({ state: 'loaded', items: auctionSaleRows(next.items), nextCursor: next.nextCursor, hasMore: next.hasMore, errorMessage: '' })
    } catch {
      if (!isLatestSalesRequest(requestToken, token, unloaded)) return
      this.setData({ state: this.data.items.length ? 'loaded' : 'error', errorMessage: '成交纪录加载失败，请重试' })
    } finally {
      if (isLatestSalesRequest(requestToken, token, unloaded)) this.setData({ loadingMore: false })
    }
  },
})
