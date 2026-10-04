import type { DivisionStandingsResponse } from '@efm/contracts'
import { ApiError } from '../../services/api'
import { leaguesApi } from '../../services/leagues'
import { initialStageIndex, standingRows, standingsErrorMessage, standingsTabs } from './standings.viewmodel'

type LoadOptions = { leagueId?: string; seasonId?: string; teamName?: string }

Page({
  data: {
    loading: true,
    errorMessage: '',
    leagueId: '',
    seasonId: '',
    myTeamName: '',
    response: null as DivisionStandingsResponse | null,
    tabs: [] as ReturnType<typeof standingsTabs>,
    selectedIndex: 0,
    selectedLabel: '',
    rows: [] as ReturnType<typeof standingRows>,
    updatedLabel: '等待首场比赛',
  },
  onLoad(options: LoadOptions) {
    if (!options.leagueId || !options.seasonId) {
      this.setData({ loading: false, errorMessage: '积分榜参数缺失，请返回联赛重新进入' })
      return
    }
    this.setData({ leagueId: options.leagueId, seasonId: options.seasonId, myTeamName: decodeURIComponent(options.teamName ?? '') })
    void this.load()
  },
  onPullDownRefresh() { void this.load(false).finally(() => wx.stopPullDownRefresh()) },
  retry() { void this.load() },
  selectStage(event: { currentTarget: { dataset: { index?: number } } }) {
    const index = Number(event.currentTarget.dataset.index ?? 0)
    this.presentStage(index)
  },
  presentStage(index: number) {
    const group = this.data.response?.groups[index]
    if (!group) return
    this.setData({
      selectedIndex: index,
      selectedLabel: group.stage.displayName,
      rows: standingRows(group.standings.rows, this.data.myTeamName),
      updatedLabel: group.standings.generatedAt ? `更新于 ${group.standings.generatedAt.slice(0, 16).replace('T', ' ')}` : '等待首场比赛',
    })
  },
  async load(showLoading = true) {
    if (showLoading) this.setData({ loading: true, errorMessage: '' })
    try {
      const response = await leaguesApi.divisionStandings(this.data.leagueId, this.data.seasonId)
      const selectedIndex = initialStageIndex(response)
      this.setData({ response, tabs: standingsTabs(response), errorMessage: '' })
      this.presentStage(selectedIndex)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'UNKNOWN'
      this.setData({ errorMessage: standingsErrorMessage(code) })
    } finally {
      this.setData({ loading: false })
    }
  },
})
