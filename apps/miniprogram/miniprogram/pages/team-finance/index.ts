import { economyApi } from '../../services/economy'
import { teamFinanceView } from './team-finance.viewmodel'

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error', errorMessage: '',
    teamId: '', seasonId: '', finance: null as ReturnType<typeof teamFinanceView> | null,
  },
  onLoad(options: { teamId?: string; seasonId?: string }) {
    if (!options.teamId) this.setData({ state: 'error', errorMessage: '球队参数缺失' })
    else { this.setData({ teamId: options.teamId, seasonId: options.seasonId ?? '' }); void this.loadPage() }
  },
  async loadPage() {
    this.setData({ state: 'loading' })
    try {
      const summary = await economyApi.finance(this.data.teamId, this.data.seasonId || undefined)
      this.setData({ state: 'loaded', finance: teamFinanceView(summary), seasonId: summary.seasonId ?? '' })
    } catch { this.setData({ state: 'error', errorMessage: '球队财务加载失败，请稍后重试' }) }
  },
  openPersonalLedger() {
    if (!this.data.seasonId) return
    wx.navigateTo({ url: `/pages/personal-finance/index?teamId=${encodeURIComponent(this.data.teamId)}&seasonId=${encodeURIComponent(this.data.seasonId)}` })
  },
})
