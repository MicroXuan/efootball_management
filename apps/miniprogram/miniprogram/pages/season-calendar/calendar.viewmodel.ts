import type { SeasonAgendaResponse } from '@efm/contracts'

const kinds = { FIXTURE: '比赛', TRANSFER: '转会期', VALUATION: '身价期', NOMINATION: '提名期' }
const statuses = { UPCOMING: '未开始', ACTIVE: '进行中', ENDED: '已结束' }

function date(value: Date) {
  return `${value.getFullYear()}.${String(value.getMonth() + 1).padStart(2, '0')}.${String(value.getDate()).padStart(2, '0')}`
}

function time(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

export function monthFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
}

export function moveMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number)
  return monthFromDate(new Date(year, monthNumber - 1 + delta, 1))
}

export function timezoneLabel(value: Date) {
  const offset = -value.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  return `设备本地时间 · UTC${sign}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? `:${String(Math.abs(offset) % 60).padStart(2, '0')}` : ''}`
}

export function agendaGroups(response: SeasonAgendaResponse) {
  const groups = new Map<string, Array<{
    id: string; kind: string; title: string; range: string; status: string; statusTone: string; targetPath: string | null
  }>>()
  for (const item of response.items) {
    const start = new Date(item.startsAt)
    const end = new Date(item.endsAt)
    const day = date(start)
    const rows = groups.get(day) ?? []
    rows.push({
      id: item.id,
      kind: kinds[item.kind],
      title: item.title,
      range: `${day} ${time(start)} — ${date(end)} ${time(end)}`,
      status: statuses[item.status],
      statusTone: item.status === 'ACTIVE' ? 'active' : item.status === 'UPCOMING' ? 'upcoming' : 'ended',
      targetPath: item.targetPath
    })
    groups.set(day, rows)
  }
  return Array.from(groups, ([day, items]) => ({ day, items }))
}
