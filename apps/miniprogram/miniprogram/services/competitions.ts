import type {
  CompetitionDetail,
  CupBracketView,
  CompetitionListResponse,
  CompetitionMatchResponse,
  CompetitionRegistrationResponse,
  CompetitionParticipantSummary,
  CupRegistrationResponse,
  MyCompetitionListResponse,
  MyMatchListResponse,
  StandingsSnapshotResponse,
  SeasonEntryResponse,
  ManagerMatchResultRequest,
  ParsedCreateCompetitionRequest,
  SeasonFixtureListResponse,
  SeasonFixtureStatus,
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

export type CompetitionListOptions = {
  cursor?: string
  limit?: number
  seasonId?: string
  category?: 'CUP'
}

export type MyMatchListOptions = {
  cursor?: string
  limit?: number
  seasonId?: string
  upcomingOnly?: boolean
}

export type SeasonFixtureListOptions = {
  team?: string
  status?: SeasonFixtureStatus
  scope?: 'ALL'|'MINE'
  leagueTeamId?: string
  cursor?: string
  limit?: number
}

export function competitionListPath(options: CompetitionListOptions = {}): string {
  return query('/competitions', {
    cursor: options.cursor,
    limit: options.limit ?? 20,
    seasonId: options.seasonId,
    category: options.category,
  })
}

export function myMatchesPath(options: MyMatchListOptions = {}): string {
  return query('/me/matches', {
    cursor: options.cursor,
    limit: options.limit ?? 20,
    seasonId: options.seasonId,
    upcomingOnly: options.upcomingOnly ? 'true' : undefined,
  })
}

export function seasonFixturesPath(
  leagueId: string,
  seasonId: string,
  options: SeasonFixtureListOptions = {},
): string {
  const team = options.team?.trim()
  return query(
    `/me/leagues/${encodeURIComponent(leagueId)}/seasons/${encodeURIComponent(seasonId)}/fixtures`,
    {
      team: team || undefined,
      status: options.status ?? 'ALL',
      scope: options.scope === 'MINE' ? 'MINE' : undefined,
      leagueTeamId: options.scope === 'MINE' ? options.leagueTeamId : undefined,
      cursor: options.cursor,
      limit: options.limit ?? 20,
    },
  )
}

export const competitionsApi = {
  list(options: CompetitionListOptions = {}) {
    return api.request<CompetitionListResponse>({ path: competitionListPath(options), skipAuth: true })
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
  myMatches(options: MyMatchListOptions = {}) {
    return api.request<MyMatchListResponse>({ path: myMatchesPath(options) })
  },
  seasonFixtures(leagueId: string, seasonId: string, options: SeasonFixtureListOptions = {}) {
    return api.request<SeasonFixtureListResponse>({
      path: seasonFixturesPath(leagueId, seasonId, options),
    })
  },
  register(competitionId: string, gameAccountId: string, acceptedRuleVersion: number) {
    return api.request<CompetitionRegistrationResponse>({
      path: `/competitions/${encodeURIComponent(competitionId)}/registrations`,
      method: 'POST',
      headers: { 'Idempotency-Key': actionKey() },
      data: { gameAccountId, acceptedRuleVersion },
    })
  },
  seasonEntry(seasonId: string) {
    return api.request<SeasonEntryResponse | null>({
      path: `/seasons/${encodeURIComponent(seasonId)}/entries/me`,
    })
  },
  cupRegistration(competitionId: string) {
    return api.request<CupRegistrationResponse | null>({
      path: `/cups/${encodeURIComponent(competitionId)}/registration/me`,
    })
  },
  registerCup(competitionId: string, seasonEntryId: string, acceptedRuleVersion: number) {
    return api.request<CupRegistrationResponse>({
      path: `/cups/${encodeURIComponent(competitionId)}/registration`,
      method: 'POST',
      headers: { 'Idempotency-Key': actionKey() },
      data: { seasonEntryId, acceptedRuleVersion },
    })
  },
  withdrawCup(competitionId: string, expectedVersion: number) {
    return api.request<CupRegistrationResponse>({
      path: `/cups/${encodeURIComponent(competitionId)}/registration/me`,
      method: 'DELETE',
      headers: { 'Idempotency-Key': actionKey() },
      data: { expectedVersion },
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
  bracket(competitionId: string) {
    return api.request<CupBracketView | null>({
      path: `/cups/${encodeURIComponent(competitionId)}/bracket`, skipAuth: true,
    })
  },
  cupParticipants(competitionId: string) {
    return api.request<CompetitionParticipantSummary[]>({
      path: `/cups/${encodeURIComponent(competitionId)}/participants`, skipAuth: true,
    })
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
  cancel(id: string, expectedVersion: number, reason: string) {
    return api.request<CompetitionDetail>({
      path: `/admin/competitions/${encodeURIComponent(id)}/cancel`,
      method: 'POST', headers: { 'Idempotency-Key': actionKey() }, data: { expectedVersion, reason },
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
