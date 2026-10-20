import type { SeasonAgendaItem, SeasonAgendaResponse } from '@efm/contracts'

const labels = { TRANSFER: '转会', FORCED_OFFER: '强报', VALUATION: '身价', NOMINATION: '提名', MANUAL: '事项' } as const
const statusLabels = { UPCOMING: '未开始', ACTIVE: '进行中', ENDED: '已结束' } as const
const beijingOffset = 8 * 60 * 60 * 1000

export function monthFromDate(value: Date) {
  return new Date(value.getTime() + beijingOffset).toISOString().slice(0, 7)
}

export function moveMonth(month: string, delta: number) {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, number! - 1 + delta, 1)).toISOString().slice(0, 7)
}

function shortDate(value: string) {
  return `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`
}

function beijingDateTime(value: string) {
  const shifted = new Date(new Date(value).getTime() + beijingOffset).toISOString()
  return `${shortDate(shifted.slice(0, 10))} ${shifted.slice(11, 16)}`
}

function itemRange(item: SeasonAgendaItem) {
  if (item.kind === 'MANUAL') return `${shortDate(item.firstDate)}${item.lastDate === item.firstDate ? '' : ` — ${shortDate(item.lastDate)}`} · 全天`
  return `${beijingDateTime(item.startsAt)} — ${beijingDateTime(item.endsAt)} · 北京时间`
}

export function buildMonthCalendar(response: SeasonAgendaResponse) {
  const [year, month] = response.month.split('-').map(Number)
  const first = new Date(Date.UTC(year!, month! - 1, 1))
  const leading = (first.getUTCDay() + 6) % 7
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year!, month! - 1, index + 1 - leading)).toISOString().slice(0, 10)
    return {
      date,
      dayNumber: Number(date.slice(8, 10)),
      inMonth: date.startsWith(response.month),
      markers: response.items.filter((item) => item.firstDate <= date && item.lastDate >= date)
        .map((item) => ({ id: `${item.kind}:${item.id}`, label: labels[item.kind], tone: item.kind.toLowerCase().replace('_', '-') }))
    }
  })
  return {
    weeks: Array.from({ length: 6 }, (_, index) => ({ id: index, days: days.slice(index * 7, index * 7 + 7) })),
    summary: response.items.map((item) => ({
      id: `${item.kind}:${item.id}`, kind: labels[item.kind], title: item.title,
      range: itemRange(item), description: item.description,
      status: statusLabels[item.status], tone: item.kind.toLowerCase().replace('_', '-')
    }))
  }
}
