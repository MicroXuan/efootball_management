import { economyApi } from '../../services/economy'
import {
  filterTransactions,
  transactionView,
  type TransactionDirectionFilter,
  type TransactionTypeFilter,
  type TransactionView
} from './league-transactions.viewmodel'

Page({
  data: {
    state: 'loading' as 'loading'|'loaded'|'error',
    errorMessage: '',
    leagueId: '',
    allItems: [] as TransactionView[],
    items: [] as TransactionView[],
    directionFilter: 'ALL' as TransactionDirectionFilter,
    typeFilter: 'ALL' as TransactionTypeFilter,
    nextCursor: null as string|null,
    loadingMore: false
  },
  onLoad(options: { leagueId?: string }) {
    if (!options.leagueId) this.setData({ state: 'error', errorMessage: '联赛参数缺失' })
    else { this.setData({ leagueId: options.leagueId }); void this.loadPage() }
  },
  async loadPage() {
    this.setData({ state: 'loading' })
    try {
      const result = await economyApi.transactions(this.data.leagueId)
      const allItems = result.items.map(transactionView)
      this.setData({ state: 'loaded', allItems, items: allItems, nextCursor: result.nextCursor })
    } catch {
      this.setData({ state: 'error', errorMessage: '交易记录加载失败，请稍后重试' })
    }
  },
  switchDirection(event: WechatMiniprogram.BaseEvent) {
    const directionFilter = event.currentTarget.dataset.filter as TransactionDirectionFilter|undefined
    if (!directionFilter || directionFilter === this.data.directionFilter) return
    this.setData({
      directionFilter,
      items: filterTransactions(this.data.allItems, directionFilter, this.data.typeFilter)
    })
  },
  switchType(event: WechatMiniprogram.BaseEvent) {
    const typeFilter = event.currentTarget.dataset.filter as TransactionTypeFilter|undefined
    if (!typeFilter || typeFilter === this.data.typeFilter) return
    this.setData({
      typeFilter,
      items: filterTransactions(this.data.allItems, this.data.directionFilter, typeFilter)
    })
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) return
    this.setData({ loadingMore: true })
    try {
      const result = await economyApi.transactions(this.data.leagueId, this.data.nextCursor)
      const allItems = [...this.data.allItems, ...result.items.map(transactionView)]
      this.setData({
        allItems,
        items: filterTransactions(allItems, this.data.directionFilter, this.data.typeFilter),
        nextCursor: result.nextCursor
      })
    } catch {
      wx.showToast({ title: '加载更多失败，请重试', icon: 'none' })
    } finally {
      this.setData({ loadingMore: false })
    }
  }
})
