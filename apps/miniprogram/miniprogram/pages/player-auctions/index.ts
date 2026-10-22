import type { MyPlayerAuctionListItem } from '@efm/contracts'
import { listMyPlayerAuctions } from '../../services/player-auctions'
import { displayableAuctions, groupAuctionsByLeague, playerAuctionStatusLabel, type PlayerAuctionLeagueGroup } from './player-auctions.viewmodel'

type AuctionTapEvent = { currentTarget: { dataset: { batchId?: string } } }

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    groups: [] as Array<PlayerAuctionLeagueGroup & { items: Array<MyPlayerAuctionListItem & { statusLabel: string }> }>,
  },

  onShow() {
    void this.loadAuctions(this.data.state !== 'loaded')
  },

  onPullDownRefresh() {
    void this.loadAuctions(false).finally(() => wx.stopPullDownRefresh())
  },

  async loadAuctions(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      const items = await listMyPlayerAuctions('all')
      const groups = groupAuctionsByLeague(displayableAuctions(items)).map((group) => ({
        ...group,
        items: group.items.map((item) => ({ ...item, statusLabel: playerAuctionStatusLabel(item.status) })),
      }))
      this.setData({ state: 'loaded', groups, errorMessage: '' })
    } catch {
      this.setData({
        state: !showLoading && this.data.state === 'loaded' ? 'loaded' : 'error',
        errorMessage: '拍卖列表加载失败，请检查网络后重试',
      })
    }
  },

  openRoom(event: AuctionTapEvent) {
    const batchId = event.currentTarget.dataset.batchId
    if (!batchId) return
    wx.navigateTo({ url: `/pages/auction-room/index?batchId=${encodeURIComponent(batchId)}` })
  },

  openSales() {
    wx.navigateTo({ url: '/pages/auction-sales/index' })
  },
})
