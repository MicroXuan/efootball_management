import type { LeagueTransactionListResponse, PersonalFinanceEntry, PersonalFinanceEntryInput, PersonalFinanceList, PersonalFinanceUpdate, PublicTeamAssets, ReleaseOwnedPlayerRequest, RosterMutationResponse, TeamAssetOverview, TeamFinanceSummary } from '@efm/contracts'
import { api } from './api'

const id = (value: string) => encodeURIComponent(value)
export const economyApi = {
  assets(teamId: string) { return api.request<TeamAssetOverview>({ path: `/me/league-teams/${id(teamId)}/assets` }) },
  publicAssets(leagueId: string, teamId: string) { return api.request<PublicTeamAssets>({ path: `/me/leagues/${id(leagueId)}/teams/${id(teamId)}/public-assets` }) },
  transactions(leagueId: string, cursor?: string) { return api.request<LeagueTransactionListResponse>({ path: `/me/leagues/${id(leagueId)}/transactions?limit=30${cursor ? `&cursor=${id(cursor)}` : ''}` }) },
  finance(teamId: string, seasonId?: string) { return api.request<TeamFinanceSummary>({ path: `/me/league-teams/${id(teamId)}/finance${seasonId ? `?seasonId=${id(seasonId)}` : ''}` }) },
  personalFinance(teamId: string, seasonId: string) { return api.request<PersonalFinanceList>({ path: `/me/league-teams/${id(teamId)}/personal-finance?seasonId=${id(seasonId)}` }) },
  addPersonalFinance(teamId: string, input: PersonalFinanceEntryInput) { return api.request<PersonalFinanceEntry>({ path: `/me/league-teams/${id(teamId)}/personal-finance`, method: 'POST', data: input }) },
  updatePersonalFinance(teamId: string, entryId: string, input: PersonalFinanceUpdate) { return api.request<PersonalFinanceEntry>({ path: `/me/league-teams/${id(teamId)}/personal-finance/${id(entryId)}`, method: 'PATCH', data: input }) },
  deletePersonalFinance(teamId: string, entryId: string, seasonId: string) { return api.request<{ deleted: true }>({ path: `/me/league-teams/${id(teamId)}/personal-finance/${id(entryId)}?seasonId=${id(seasonId)}`, method: 'DELETE' }) },
  releasePlayer(teamId: string, ownershipId: string, input: ReleaseOwnedPlayerRequest, key: string) {
    return api.request<RosterMutationResponse>({
      path: `/me/league-teams/${id(teamId)}/roster/${id(ownershipId)}/release`,
      method: 'POST', headers: { 'Idempotency-Key': key }, data: input,
    })
  },
}
