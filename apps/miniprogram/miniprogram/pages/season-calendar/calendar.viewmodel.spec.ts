import { expect, it } from 'vitest'
import { agendaGroups, moveMonth, timezoneLabel } from './calendar.viewmodel'

it('groups agenda events by local day and gives windows clear state labels', () => {
  const groups = agendaGroups({ month: '2026-10', items: [
    { id: 'window-1', kind: 'TRANSFER', title: '秋季转会期', startsAt: '2026-10-19T12:00:00.000Z', endsAt: '2026-10-29T00:00:00.000Z', status: 'ACTIVE', targetPath: null },
    { id: 'fixture-1', kind: 'FIXTURE', title: '阿哈尔 vs 阿贾克斯', startsAt: '2026-10-19T13:00:00.000Z', endsAt: '2026-10-19T15:00:00.000Z', status: 'UPCOMING', targetPath: '/pages/my-matches/index' }
  ] })
  expect(groups).toHaveLength(1)
  expect(groups[0]?.items).toMatchObject([{ kind: '转会期', status: '进行中' }, { kind: '比赛', status: '未开始' }])
  expect(moveMonth('2026-12', 1)).toBe('2027-01')
  expect(timezoneLabel(new Date())).toContain('设备本地时间 · UTC')
})
