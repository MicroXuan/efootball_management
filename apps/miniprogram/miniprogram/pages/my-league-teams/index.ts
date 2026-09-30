import { leagueTeamsApi } from '../../services/league-teams'
import { formatPublicUserNo, presentLeagueTeams, type LeagueTeamListItem } from './my-league-teams.viewmodel'

Page({
  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    errorMessage: '',
    teams: [] as LeagueTeamListItem[],
    publicUserNoDisplay: '',
    publicUserNoCopy: '',
  },
  onLoad() { void this.loadPage() },
  onPullDownRefresh() { void this.loadPage(false).finally(() => wx.stopPullDownRefresh()) },
  async loadPage(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      const result = await leagueTeamsApi.mine()
      const userNo = result.items[0]?.ownerPublicUserNo
      const formatted = userNo ? formatPublicUserNo(userNo) : { display: '暂无编号', copyValue: '' }
      this.setData({ state: 'loaded', teams: presentLeagueTeams(result.items), publicUserNoDisplay: formatted.display, publicUserNoCopy: formatted.copyValue })
    } catch {
      this.setData({ state: 'error', errorMessage: '联赛球队加载失败，请稍后重试' })
    }
  },
  copyUserNo() {
    if (!this.data.publicUserNoCopy) return
    wx.setClipboardData({ data: this.data.publicUserNoCopy })
  },
  openTeam(event: { currentTarget: { dataset: { id?: string } } }) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/league-team-detail/index?id=${encodeURIComponent(id)}` })
  },
})
