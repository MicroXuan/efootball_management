import type { DisappearanceRequest, RespondTransferProposal, SubmitDisappearanceRequest, SubmitTransferProposal, TransferCandidate, TransferProposal } from '@efm/contracts'
import { api } from './api'

const id = (value: string) => encodeURIComponent(value)

export const playerRequestsApi = {
  submitDisappearance(teamId: string, ownershipId: string, input: SubmitDisappearanceRequest, key: string) {
    return api.request<DisappearanceRequest>({ path: `/me/league-teams/${id(teamId)}/roster/${id(ownershipId)}/disappearance-requests`,
      method: 'POST', headers: { 'Idempotency-Key': key }, data: input })
  },
  transferCandidate(leagueId: string, seasonId: string, playerId: string) {
    return api.request<TransferCandidate>({ path: `/me/leagues/${id(leagueId)}/transfer-candidates/${id(playerId)}?seasonId=${id(seasonId)}` })
  },
  submitTransfer(input: SubmitTransferProposal, key: string) {
    return api.request<TransferProposal>({ path: '/me/transfer-proposals', method: 'POST',
      headers: { 'Idempotency-Key': key }, data: input })
  },
  respondTransfer(proposalId: string, input: RespondTransferProposal, key: string) {
    return api.request<TransferProposal>({ path: `/me/transfer-proposals/${id(proposalId)}/respond`, method: 'POST',
      headers: { 'Idempotency-Key': key }, data: input })
  },
  listTransfers(seasonId: string) {
    return api.request<{ items: TransferProposal[] }>({ path: `/me/transfer-proposals?seasonId=${id(seasonId)}` })
  },
  listDisappearance(seasonId: string) {
    return api.request<{ items: DisappearanceRequest[] }>({ path: `/me/player-requests?seasonId=${id(seasonId)}` })
  },
}
