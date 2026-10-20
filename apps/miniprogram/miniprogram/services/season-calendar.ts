import type { SeasonAgendaResponse } from '@efm/contracts'
import { api } from './api'

const id = (value: string) => encodeURIComponent(value)

export const seasonCalendarApi = {
  list(leagueId: string, seasonId: string, month: string) {
    return api.request<SeasonAgendaResponse>({ path: `/me/leagues/${id(leagueId)}/seasons/${id(seasonId)}/agenda?month=${id(month)}` })
  }
}
