import type {
  CompetitionDetail,
  CompetitionListResponse,
  CompetitionMatchResponse,
  CompetitionRegistrationResponse,
  MyCompetitionListResponse,
  MyMatchListResponse,
  StandingsSnapshotResponse,
} from '@efm/contracts'
import { api } from './api'

function actionKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function query(path: string, values: Record<string, string | number | undefined>): string {
  const encoded = Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return `${path}${encoded ? `?${encoded}` : ''}`
}

export const competitionsApi = {
  list(cursor?: string, limit = 20) {
    return api.request<CompetitionListResponse>({ path: query('/competitions', { cursor, limit }), skipAuth: true })
  },
  detail(id: string) {
    return api.request<CompetitionDetail>({ path: `/competitions/${encodeURIComponent(id)}`, skipAuth: true })
  },
  mine(cursor?: string, limit = 100) {
    return api.request<MyCompetitionListResponse>({ path: query('/me/competitions', { cursor, limit }) })
  },
  myMatches(cursor?: string, limit = 20) {
    return api.request<MyMatchListResponse>({ path: query('/me/matches', { cursor, limit }) })
  },
  register(competitionId: string, gameAccountId: string, acceptedRuleVersion: number) {
    return api.request<CompetitionRegistrationResponse>({
      path: `/competitions/${encodeURIComponent(competitionId)}/registrations`,
      method: 'POST',
      headers: { 'Idempotency-Key': actionKey() },
      data: { gameAccountId, acceptedRuleVersion },
    })
  },
  withdraw(competitionId: string, expectedVersion: number) {
    return api.request<CompetitionRegistrationResponse>({
      path: `/competitions/${encodeURIComponent(competitionId)}/registrations/me`,
      method: 'DELETE',
      headers: { 'Idempotency-Key': actionKey() },
      data: { expectedVersion },
    })
  },
  matches(competitionId: string) {
    return api.request<CompetitionMatchResponse[]>({
      path: `/competitions/${encodeURIComponent(competitionId)}/matches`, skipAuth: true,
    })
  },
  standings(competitionId: string) {
    return api.request<StandingsSnapshotResponse>({
      path: `/competitions/${encodeURIComponent(competitionId)}/standings`, skipAuth: true,
    })
  },
}
