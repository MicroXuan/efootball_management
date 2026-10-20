import { seasonCalendarApi } from '../../services/season-calendar'
import { buildMonthCalendar, monthFromDate, moveMonth } from './calendar.viewmodel'

type Calendar = ReturnType<typeof buildMonthCalendar>
let loadGeneration = 0

Page({
  data: {
    state: 'loading' as 'loading'|'loaded'|'error',
    errorMessage: '',
    leagueId: '', seasonId: '',
    month: monthFromDate(new Date()),
    monthLabel: '',
    hasSeason: false,
    weeks: [] as Calendar['weeks'],
    summary: [] as Calendar['summary']
  },
  onLoad(options: { leagueId?: string; seasonId?: string }) {
    if (!options.leagueId || !options.seasonId) this.setData({ state: 'error', errorMessage: '联赛或赛季参数缺失' })
    else { this.setData({ leagueId: options.leagueId, seasonId: options.seasonId }); void this.loadPage() }
  },
  onUnload() { loadGeneration += 1 },
  onPullDownRefresh() { void this.loadPage().finally(() => wx.stopPullDownRefresh()) },
  async loadPage() {
    const generation = ++loadGeneration
    this.setData({ state: 'loading', errorMessage: '', weeks: [], summary: [] })
    try {
      const response = await seasonCalendarApi.list(this.data.leagueId, this.data.seasonId, this.data.month)
      if (generation !== loadGeneration) return
      const calendar = buildMonthCalendar(response)
      this.setData({ state: 'loaded', hasSeason: Boolean(response.seasonId), ...calendar, monthLabel: this.data.month.replace('-', ' 年 ') + ' 月' })
    } catch {
      if (generation === loadGeneration) this.setData({ state: 'error', errorMessage: '赛季日历加载失败，请稍后重试' })
    }
  },
  previousMonth() { this.setData({ month: moveMonth(this.data.month, -1) }); void this.loadPage() },
  nextMonth() { this.setData({ month: moveMonth(this.data.month, 1) }); void this.loadPage() }
})
