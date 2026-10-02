import type { LeagueTransactionListResponse, TeamAssetOverview, TeamFinanceSummary } from '@efm/contracts'
import { api } from './api'

const id = (value: string) => encodeURIComponent(value)
export const economyApi = {
  assets(teamId: string) { return api.request<TeamAssetOverview>({ path: `/me/league-teams/${id(teamId)}/assets` }) },
  transactions(leagueId: string) { return api.request<LeagueTransactionListResponse>({ path: `/me/leagues/${id(leagueId)}/transactions` }) },
  finance(teamId: string, seasonId?: string) { return api.request<TeamFinanceSummary>({ path: `/me/league-teams/${id(teamId)}/finance${seasonId ? `?seasonId=${id(seasonId)}` : ''}` }) },
}
