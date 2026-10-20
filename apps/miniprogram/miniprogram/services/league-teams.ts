import type { MyLeagueTeamListResponse, MyLeagueTeamOverview, PublicLeagueTeamDirectory } from '@efm/contracts'
import { api } from './api'

const id = (value: string) => encodeURIComponent(value)

export const leagueTeamsApi = {
  mine() {
    return api.request<MyLeagueTeamListResponse>({ path: '/me/league-teams' })
  },
  overview(teamId: string) {
    return api.request<MyLeagueTeamOverview>({ path: `/me/league-teams/${id(teamId)}/overview` })
  },
  directory(leagueId: string) {
    return api.request<PublicLeagueTeamDirectory>({ path: `/me/leagues/${id(leagueId)}/teams` })
  },
}
