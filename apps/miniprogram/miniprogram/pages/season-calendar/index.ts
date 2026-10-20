import { seasonCalendarApi } from '../../services/season-calendar'
import { agendaGroups, monthFromDate, moveMonth, timezoneLabel } from './calendar.viewmodel'

type Groups = ReturnType<typeof agendaGroups>
let loadGeneration = 0

Page({
  data: {
    state: 'loading' as 'loading'|'loaded'|'error',
    errorMessage: '',
    leagueId: '', seasonId: '',
    month: monthFromDate(new Date()),
    monthLabel: '',
    timezoneCopy: timezoneLabel(new Date()),
    groups: [] as Groups
  },
  onLoad(options: { leagueId?: string; seasonId?: string }) {
    if (!options.leagueId || !options.seasonId) this.setData({ state: 'error', errorMessage: '联赛或赛季参数缺失' })
    else { this.setData({ leagueId: options.leagueId, seasonId: options.seasonId }); void this.loadPage() }
  },
  onUnload() { loadGeneration += 1 },
  onPullDownRefresh() { void this.loadPage().finally(() => wx.stopPullDownRefresh()) },
  async loadPage() {
    const generation = ++loadGeneration
    this.setData({ state: 'loading', errorMessage: '', groups: [] })
    try {
      const response = await seasonCalendarApi.list(this.data.leagueId, this.data.seasonId, this.data.month)
      if (generation !== loadGeneration) return
      this.setData({ state: 'loaded', groups: agendaGroups(response), monthLabel: this.data.month.replace('-', ' 年 ') + ' 月', timezoneCopy: timezoneLabel(new Date()) })
    } catch {
      if (generation === loadGeneration) this.setData({ state: 'error', errorMessage: '日程加载失败，请确认你已获得本赛季参赛资格' })
    }
  },
  previousMonth() { this.setData({ month: moveMonth(this.data.month, -1) }); void this.loadPage() },
  nextMonth() { this.setData({ month: moveMonth(this.data.month, 1) }); void this.loadPage() },
  openItem(event: { currentTarget: { dataset: { path?: string } } }) {
    const path = event.currentTarget.dataset.path
    if (path?.startsWith('/pages/')) wx.navigateTo({ url: path })
  }
})
