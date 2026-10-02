import type { MyLeagueTeamOverview } from '@efm/contracts'
import { leagueTeamsApi } from '../../services/league-teams'
import { ledgerAmount, rosterState } from './league-team-detail.viewmodel'

Page({
  data: { state: 'loading' as 'loading'|'loaded'|'error', errorMessage: '', overview: null as MyLeagueTeamOverview|null, rosterEmpty: false, overCap: false, ledger: [] as Array<MyLeagueTeamOverview['ledger'][number] & { amountCopy: string }> },
  onLoad(options: { id?: string }) { if (!options.id) this.setData({ state: 'error', errorMessage: '球队参数缺失' }); else void this.loadPage(options.id) },
  async loadPage(teamId: string) {
    try {
      const overview = await leagueTeamsApi.overview(teamId)
      const flags = rosterState(overview.roster, overview.team.rosterStatus)
      this.setData({ state: 'loaded', overview, rosterEmpty: flags.empty, overCap: flags.overCap, ledger: overview.ledger.map((entry) => ({ ...entry, amountCopy: ledgerAmount(entry.direction, entry.amountMinor) })) })
    } catch { this.setData({ state: 'error', errorMessage: '球队档案加载失败，请稍后重试' }) }
  },
  openValuation() { if (this.data.overview) wx.navigateTo({ url: `/pages/valuation-manage/index?teamId=${this.data.overview.team.id}` }) },
})
