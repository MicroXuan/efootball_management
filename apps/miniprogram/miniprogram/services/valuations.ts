import type { PublishValuationSubmissionRequest, SaveValuationDraftRequest, ValuationSubmissionSummary, ValuationWorkspace } from '@efm/contracts'
import { api } from './api'

const id = (value: string) => encodeURIComponent(value)
export const valuationsApi = {
  workspace(teamId: string) { return api.request<ValuationWorkspace>({ path: `/me/league-teams/${id(teamId)}/valuations/workspace` }) },
  saveDraft(teamId: string, data: SaveValuationDraftRequest) { return api.request<ValuationSubmissionSummary>({ path: `/me/league-teams/${id(teamId)}/valuations/draft`, method: 'PATCH', data }) },
  publish(teamId: string, data: PublishValuationSubmissionRequest, key: string) { return api.request<ValuationSubmissionSummary>({ path: `/me/league-teams/${id(teamId)}/valuations/publish`, method: 'POST', data, headers: { 'Idempotency-Key': key } }) },
}
