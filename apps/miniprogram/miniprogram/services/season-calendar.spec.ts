import { expect, it, vi } from 'vitest'
import { api } from './api'
import { seasonCalendarApi } from './season-calendar'

it('requests the selected month in one season without a separate calendar copy', async () => {
  const request = vi.spyOn(api, 'request').mockResolvedValue({ month: '2026-10', items: [] })
  await seasonCalendarApi.list('league / 1', 'season / 2', '2026-10')
  expect(request).toHaveBeenCalledWith({ path: '/me/leagues/league%20%2F%201/seasons/season%20%2F%202/agenda?month=2026-10' })
  vi.restoreAllMocks()
})
