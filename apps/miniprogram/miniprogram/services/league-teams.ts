import type { MyLeagueTeamListResponse, MyLeagueTeamOverview } from '@efm/contracts'
import { api } from './api'

const id = (value: string) => encodeURIComponent(value)

export const leagueTeamsApi = {
  mine() {
    return api.request<MyLeagueTeamListResponse>({ path: '/me/league-teams' })
  },
  overview(teamId: string) {
    return api.request<MyLeagueTeamOverview>({ path: `/me/league-teams/${id(teamId)}/overview` })
  },
}
