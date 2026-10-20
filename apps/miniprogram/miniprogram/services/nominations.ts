import type { MyNominationWorkspace, NominationWindow, PlayerNomination } from '@efm/contracts'
import { api } from './api'

const id = encodeURIComponent
const mutationKey = () => `nomination-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export const nominationsApi = {
  listWindows(leagueId: string, seasonId: string): Promise<{ items: NominationWindow[] }> {
    return api.request({ path: `/me/leagues/${id(leagueId)}/seasons/${id(seasonId)}/nomination-windows` })
  },
  workspace(windowId: string): Promise<MyNominationWorkspace> {
    return api.request({ path: `/me/nomination-windows/${id(windowId)}/nominations` })
  },
  submit(windowId: string, playerId: string): Promise<PlayerNomination> {
    return api.request({ path: `/me/nomination-windows/${id(windowId)}/nominations`, method: 'POST', headers: { 'Idempotency-Key': mutationKey() }, data: { playerId } })
  },
  withdraw(windowId: string, nominationId: string): Promise<PlayerNomination> {
    return api.request({ path: `/me/nomination-windows/${id(windowId)}/nominations/${id(nominationId)}`, method: 'DELETE', headers: { 'Idempotency-Key': mutationKey() } })
  },
}
