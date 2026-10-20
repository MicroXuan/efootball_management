import type { PublicLeagueTeamDirectory } from '@efm/contracts'
import { leagueTeamsApi } from '../../services/league-teams'
import { directoryRows } from './directory.viewmodel'

type DirectoryRow = ReturnType<typeof directoryRows>[number]

Page({
  data: {
    state: 'loading' as 'loading'|'loaded'|'error',
    errorMessage: '',
    leagueId: '',
    keyword: '',
    directory: { items: [] } as PublicLeagueTeamDirectory,
    rows: [] as DirectoryRow[]
  },
  onLoad(options: { leagueId?: string }) {
    if (!options.leagueId) this.setData({ state: 'error', errorMessage: '联赛参数缺失' })
    else { this.setData({ leagueId: options.leagueId }); void this.loadPage() }
  },
  onPullDownRefresh() { void this.loadPage(false).finally(() => wx.stopPullDownRefresh()) },
  async loadPage(showLoading = true) {
    if (showLoading) this.setData({ state: 'loading', errorMessage: '' })
    try {
      const directory = await leagueTeamsApi.directory(this.data.leagueId)
      this.setData({ state: 'loaded', directory, rows: directoryRows(directory, this.data.keyword) })
    } catch { this.setData({ state: 'error', errorMessage: '球队列表加载失败，请确认当前账号已加入这个联赛' }) }
  },
  search(event: { detail: { value: string } }) {
    const keyword = event.detail.value
    this.setData({ keyword, rows: directoryRows(this.data.directory, keyword) })
  },
  openTeam(event: { currentTarget: { dataset: { teamId?: string } } }) {
    const teamId = event.currentTarget.dataset.teamId
    if (teamId) wx.navigateTo({ url: `/pages/team-assets/index?leagueId=${encodeURIComponent(this.data.leagueId)}&teamId=${encodeURIComponent(teamId)}&view=public` })
  }
})
