import { expect, it } from 'vitest'
import type { SeasonAgendaResponse } from '@efm/contracts'
import { buildMonthCalendar, monthFromDate, moveMonth } from './calendar.viewmodel'

const response: SeasonAgendaResponse = {
  month: '2026-10', seasonId: 'season-1', timezone: 'Asia/Shanghai', items: [
    { id: 'transfer-1', kind: 'TRANSFER', noteKind: null, title: '秋季转会期', description: null,
      startsAt: '2026-09-30T16:00:00.000Z', endsAt: '2026-10-02T16:00:00.000Z',
      firstDate: '2026-10-01', lastDate: '2026-10-02', status: 'ACTIVE', targetPath: null, version: null },
    { id: 'forced-1', kind: 'FORCED_OFFER', noteKind: null, title: '第一轮强报', description: null,
      startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-03T00:00:00.000Z',
      firstDate: '2026-10-01', lastDate: '2026-10-03', status: 'ACTIVE', targetPath: null, version: null },
    { id: 'note-1', kind: 'MANUAL', noteKind: 'NOTICE', title: '月底说明', description: '截止前完成操作',
      startsAt: null, endsAt: null, firstDate: '2026-10-31', lastDate: '2026-10-31',
      status: 'UPCOMING', targetPath: null, version: 1 }
  ]
}

it('projects inclusive phases into seven equal day cells with complete monthly summary', () => {
  const calendar = buildMonthCalendar(response)
  expect(calendar.weeks).toHaveLength(6)
  expect(calendar.weeks.every((week) => week.days.length === 7)).toBe(true)
  expect(calendar.weeks[0]?.days[0]).toMatchObject({ date: '2026-09-28', inMonth: false })
  const days = calendar.weeks.flatMap((week) => week.days)
  expect(days.find((day) => day.date === '2026-10-01')?.markers.map((marker) => marker.label)).toEqual(['转会', '强报'])
  expect(days.find((day) => day.date === '2026-10-02')?.markers.map((marker) => marker.label)).toEqual(['转会', '强报'])
  expect(days.find((day) => day.date === '2026-10-31')?.markers.map((marker) => marker.label)).toEqual(['事项'])
  expect(calendar.summary).toHaveLength(3)
  expect(calendar.summary[2]).toMatchObject({ title: '月底说明', range: '10月31日 · 全天', description: '截止前完成操作' })
  expect(calendar.summary[0]?.range).toContain('北京时间')
})

it('uses Beijing month regardless of device timezone and handles a missing current season', () => {
  expect(monthFromDate(new Date('2026-09-30T17:00:00.000Z'))).toBe('2026-10')
  expect(moveMonth('2026-12', 1)).toBe('2027-01')
  expect(buildMonthCalendar({ month: '2026-10', seasonId: null, timezone: 'Asia/Shanghai', items: [] }).summary).toEqual([])
})
