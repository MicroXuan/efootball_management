import type { MyLeagueTeamOverview } from '@efm/contracts'
import { leagueTeamsApi } from '../../services/league-teams'
import { rosterPlayerView, rosterState, teamDetailActions } from './league-team-detail.viewmodel'

Page({
  data: {
    state: 'loading' as 'loading'|'loaded'|'error', errorMessage: '', overview: null as MyLeagueTeamOverview|null,
    rosterEmpty: false, overCap: false,
    roster: [] as Array<ReturnType<typeof rosterPlayerView>>,
    actions: [] as Array<ReturnType<typeof teamDetailActions>[number]>
  },
  onLoad(options: { id?: string }) { if (!options.id) this.setData({ state: 'error', errorMessage: '球队参数缺失' }); else void this.loadPage(options.id) },
  async loadPage(teamId: string) {
    try {
      const overview = await leagueTeamsApi.overview(teamId)
      const flags = rosterState(overview.roster, overview.team.rosterStatus)
      this.setData({
        state: 'loaded', overview, rosterEmpty: flags.empty, overCap: flags.overCap,
        roster: overview.roster.map(rosterPlayerView),
        actions: [...teamDetailActions(overview.team.id, overview.team.leagueId)]
      })
    } catch { this.setData({ state: 'error', errorMessage: '球队档案加载失败，请稍后重试' }) }
  },
  openSection(event: WechatMiniprogram.TouchEvent) {
    const url = event.currentTarget.dataset.url as string | undefined
    if (url) wx.navigateTo({ url })
  },
})
