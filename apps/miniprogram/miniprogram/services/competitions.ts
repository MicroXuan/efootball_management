import type {
  CompetitionDetail,
  CompetitionListResponse,
  CompetitionMatchResponse,
  CompetitionRegistrationResponse,
  MyCompetitionListResponse,
  MyMatchListResponse,
  StandingsSnapshotResponse,
  SubmitMatchResultRequest,
  RejectMatchResultRequest,
  ManagerMatchResultRequest,
  ParsedCreateCompetitionRequest,
  UpdateCompetitionRequest,
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
  managerDetail(id: string) {
    return api.request<CompetitionDetail>({ path: `/admin/competitions/${encodeURIComponent(id)}` })
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
  submitResult(matchId: string, input: SubmitMatchResultRequest) {
    return api.request({ path: `/matches/${encodeURIComponent(matchId)}/results`, method: 'POST',
      headers: { 'Idempotency-Key': actionKey() }, data: input })
  },
  confirmResult(matchId: string, resultVersion: number, expectedVersion: number) {
    return api.request({ path: `/matches/${encodeURIComponent(matchId)}/results/${resultVersion}/confirm`, method: 'POST',
      headers: { 'Idempotency-Key': actionKey() }, data: { expectedVersion } })
  },
  rejectResult(matchId: string, resultVersion: number, input: RejectMatchResultRequest) {
    return api.request({ path: `/matches/${encodeURIComponent(matchId)}/results/${resultVersion}/reject`, method: 'POST',
      headers: { 'Idempotency-Key': actionKey() }, data: input })
  },
  create(input: ParsedCreateCompetitionRequest) {
    return api.request<CompetitionDetail>({ path: '/admin/competitions', method: 'POST',
      headers: { 'Idempotency-Key': actionKey() }, data: input })
  },
  update(id: string, input: UpdateCompetitionRequest) {
    return api.request<CompetitionDetail>({ path: `/admin/competitions/${encodeURIComponent(id)}`, method: 'PATCH',
      headers: { 'Idempotency-Key': actionKey() }, data: input })
  },
  transition(id: string, action: 'open-registration' | 'close-registration' | 'start' | 'complete', expectedVersion: number) {
    return api.request<CompetitionDetail>({
      path: `/admin/competitions/${encodeURIComponent(id)}/${action}`,
      method: 'POST', headers: { 'Idempotency-Key': actionKey() }, data: { expectedVersion },
    })
  },
  registrations(id: string) {
    return api.request<CompetitionRegistrationResponse[]>({ path: `/admin/competitions/${encodeURIComponent(id)}/registrations` })
  },
  reviewRegistration(id: string, registrationId: string, decision: 'approve' | 'reject', expectedVersion: number, reason?: string) {
    return api.request<CompetitionRegistrationResponse>({
      path: `/admin/competitions/${encodeURIComponent(id)}/registrations/${encodeURIComponent(registrationId)}/${decision}`,
      method: 'POST', headers: { 'Idempotency-Key': actionKey() },
      data: decision === 'reject' ? { decision: 'REJECT', expectedVersion, reason } : { expectedVersion },
    })
  },
  generateSchedule(id: string) {
    return api.request<SchedulePreview>({ path: `/admin/competitions/${encodeURIComponent(id)}/schedule/generate`, method: 'POST',
      headers: { 'Idempotency-Key': actionKey() } })
  },
  schedulePreview(id: string) {
    return api.request<SchedulePreview>({ path: `/admin/competitions/${encodeURIComponent(id)}/schedule/preview` })
  },
  publishSchedule(id: string, expectedCompetitionVersion: number, expectedStageVersion: number) {
    return api.request<SchedulePreview>({ path: `/admin/competitions/${encodeURIComponent(id)}/schedule/publish`, method: 'POST',
      headers: { 'Idempotency-Key': actionKey() }, data: { expectedCompetitionVersion, expectedStageVersion } })
  },
  managerResult(competitionId: string, matchId: string, input: ManagerMatchResultRequest) {
    return api.request({ path: `/admin/competitions/${encodeURIComponent(competitionId)}/matches/${encodeURIComponent(matchId)}/results`,
      method: 'POST', headers: { 'Idempotency-Key': actionKey() }, data: input })
  },
}

export type SchedulePreview = {
  id: string
  competitionId: string
  status: 'DRAFT' | 'PUBLISHED'
  version: number
  roundCount: number
  matchCount: number
  matches: CompetitionMatchResponse[]
}
