import type { LeagueTransactionListResponse, ReleaseOwnedPlayerRequest, RosterMutationResponse, TeamAssetOverview, TeamFinanceSummary } from '@efm/contracts'
import { api } from './api'

const id = (value: string) => encodeURIComponent(value)
export const economyApi = {
  assets(teamId: string) { return api.request<TeamAssetOverview>({ path: `/me/league-teams/${id(teamId)}/assets` }) },
  transactions(leagueId: string, cursor?: string) { return api.request<LeagueTransactionListResponse>({ path: `/me/leagues/${id(leagueId)}/transactions?limit=30${cursor ? `&cursor=${id(cursor)}` : ''}` }) },
  finance(teamId: string, seasonId?: string) { return api.request<TeamFinanceSummary>({ path: `/me/league-teams/${id(teamId)}/finance${seasonId ? `?seasonId=${id(seasonId)}` : ''}` }) },
  releasePlayer(teamId: string, ownershipId: string, input: ReleaseOwnedPlayerRequest, key: string) {
    return api.request<RosterMutationResponse>({
      path: `/me/league-teams/${id(teamId)}/roster/${id(ownershipId)}/release`,
      method: 'POST', headers: { 'Idempotency-Key': key }, data: input,
    })
  },
}
