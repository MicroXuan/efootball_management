import type {
  CancelLeagueSeasonRequest,
  ConfirmSeasonRenewalRequest,
  CreateLeagueRequest,
  CreateLeagueSeasonRequest,
  CreateSeasonApplicationRequest,
  CreateTeamProfileRequest,
  LeagueDetail,
  LeagueListResponse,
  LeagueSeasonDetail,
  LeagueSeasonSummary,
  OverrideSeasonEntryRequest,
  ParsedCreateLeagueRequest,
  ParsedCreateLeagueSeasonRequest,
  ParsedCreateTeamProfileRequest,
  SeasonEntryListQuery,
  SeasonEntryResponse,
  TeamProfileResponse,
  UpdateLeagueRequest,
  UpdateLeagueSeasonRequest,
  UpdateTeamProfileRequest,
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

const id = (value: string) => encodeURIComponent(value)
const mutationHeaders = () => ({ 'Idempotency-Key': actionKey() })

export const leaguesApi = {
  list(cursor?: string, limit = 20) {
    return api.request<LeagueListResponse>({
      path: query('/leagues', { cursor, limit }),
      skipAuth: true,
    })
  },
  detail(leagueId: string) {
    return api.request<LeagueDetail>({ path: `/leagues/${id(leagueId)}`, skipAuth: true })
  },
  seasons(leagueId: string) {
    return api.request<LeagueSeasonSummary[]>({
      path: `/leagues/${id(leagueId)}/seasons`,
      skipAuth: true,
    })
  },
  season(seasonId: string) {
    return api.request<LeagueSeasonDetail>({ path: `/seasons/${id(seasonId)}`, skipAuth: true })
  },
  myEntry(seasonId: string) {
    return api.request<SeasonEntryResponse | null>({ path: `/seasons/${id(seasonId)}/entries/me` })
  },
  apply(seasonId: string, input: CreateSeasonApplicationRequest) {
    return api.request<SeasonEntryResponse>({
      path: `/seasons/${id(seasonId)}/applications`,
      method: 'POST',
      headers: mutationHeaders(),
      data: input,
    })
  },
  confirmRenewal(seasonId: string, input: ConfirmSeasonRenewalRequest) {
    return api.request<SeasonEntryResponse>({
      path: `/seasons/${id(seasonId)}/renewal/confirm`,
      method: 'POST',
      headers: mutationHeaders(),
      data: input,
    })
  },
  withdraw(seasonId: string, expectedVersion: number) {
    return api.request<SeasonEntryResponse>({
      path: `/seasons/${id(seasonId)}/entries/me`,
      method: 'DELETE',
      headers: mutationHeaders(),
      data: { expectedVersion },
    })
  },
  teamProfile() {
    return api.request<TeamProfileResponse | null>({ path: '/me/team-profile' })
  },
  createTeamProfile(input: ParsedCreateTeamProfileRequest | CreateTeamProfileRequest) {
    return api.request<TeamProfileResponse>({ path: '/me/team-profile', method: 'POST', data: input })
  },
  updateTeamProfile(input: UpdateTeamProfileRequest) {
    return api.request<TeamProfileResponse>({ path: '/me/team-profile', method: 'PATCH', data: input })
  },
  managerLeague(leagueId: string) {
    return api.request<LeagueDetail>({ path: `/admin/leagues/${id(leagueId)}` })
  },
  createLeague(input: ParsedCreateLeagueRequest | CreateLeagueRequest) {
    return api.request<LeagueDetail>({
      path: '/admin/leagues', method: 'POST', headers: mutationHeaders(), data: input,
    })
  },
  updateLeague(leagueId: string, input: UpdateLeagueRequest) {
    return api.request<LeagueDetail>({
      path: `/admin/leagues/${id(leagueId)}`, method: 'PATCH', headers: mutationHeaders(), data: input,
    })
  },
  managerSeason(seasonId: string) {
    return api.request<LeagueSeasonDetail>({ path: `/admin/seasons/${id(seasonId)}` })
  },
  createSeason(leagueId: string, input: ParsedCreateLeagueSeasonRequest | CreateLeagueSeasonRequest) {
    return api.request<LeagueSeasonDetail>({
      path: `/admin/leagues/${id(leagueId)}/seasons`, method: 'POST', headers: mutationHeaders(), data: input,
    })
  },
  updateSeason(seasonId: string, input: UpdateLeagueSeasonRequest) {
    return api.request<LeagueSeasonDetail>({
      path: `/admin/seasons/${id(seasonId)}`, method: 'PATCH', headers: mutationHeaders(), data: input,
    })
  },
  transitionSeason(seasonId: string, action: 'open-registration' | 'close-registration', expectedVersion: number) {
    return api.request<LeagueSeasonDetail>({
      path: `/admin/seasons/${id(seasonId)}/${action}`,
      method: 'POST', headers: mutationHeaders(), data: { expectedVersion },
    })
  },
  cancelSeason(seasonId: string, input: CancelLeagueSeasonRequest) {
    return api.request<LeagueSeasonDetail>({
      path: `/admin/seasons/${id(seasonId)}/cancel`,
      method: 'POST', headers: mutationHeaders(), data: input,
    })
  },
  entries(seasonId: string, filters: SeasonEntryListQuery = {}) {
    return api.request<SeasonEntryResponse[]>({
      path: query(`/admin/seasons/${id(seasonId)}/entries`, filters),
    })
  },
  reviewEntry(seasonId: string, entryId: string, decision: 'approve' | 'reject', expectedVersion: number, reason?: string) {
    return api.request<SeasonEntryResponse>({
      path: `/admin/seasons/${id(seasonId)}/entries/${id(entryId)}/${decision}`,
      method: 'POST', headers: mutationHeaders(),
      data: decision === 'reject' ? { expectedVersion, reason } : { expectedVersion },
    })
  },
  overrideEntry(seasonId: string, entryId: string, input: OverrideSeasonEntryRequest) {
    return api.request<SeasonEntryResponse>({
      path: `/admin/seasons/${id(seasonId)}/entries/${id(entryId)}/override`,
      method: 'POST', headers: mutationHeaders(), data: input,
    })
  },
}
