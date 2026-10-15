import type {
  AmendPlayerApplicationRequest,
  PlayerAcquisitionApplication,
  PlayerApplicationListQuery,
  PlayerApplicationListResponse,
  PlayerMarketAnnouncementListResponse,
  PlayerMarketAnnouncementQuery,
  PlayerMarketListResponse,
  PlayerMarketPlayerDetail,
  PlayerMarketQuery,
  SubmitPlayerApplicationRequest,
  WithdrawPlayerApplicationRequest,
} from '@efm/contracts'
import { api } from './api'

const id = (value: string) => encodeURIComponent(value)

function query(path: string, values: Record<string, string | number | undefined>): string {
  const encoded = Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return `${path}${encoded ? `?${encoded}` : ''}`
}

export function createPlayerMarketMutationKey(prefix = 'market'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function playerMarketListPath(leagueId: string, options: PlayerMarketQuery): string {
  return query(`/me/leagues/${id(leagueId)}/player-market`, {
    seasonId: options.seasonId,
    keyword: options.keyword,
    position: options.position,
    ownership: options.ownership,
    cursor: options.cursor,
    limit: options.limit,
  })
}

export function playerApplicationListPath(leagueId: string, options: PlayerApplicationListQuery): string {
  return query(`/me/leagues/${id(leagueId)}/player-market-applications`, {
    seasonId: options.seasonId,
    type: options.type,
    status: options.status,
    playerId: options.playerId,
    scope: options.scope,
    cursor: options.cursor,
    limit: options.limit,
  })
}

export function listPlayerMarket(leagueId: string, options: PlayerMarketQuery): Promise<PlayerMarketListResponse> {
  return api.request({ path: playerMarketListPath(leagueId, options) })
}

export function getPlayerMarketDetail(leagueId: string, playerId: string, seasonId: string): Promise<PlayerMarketPlayerDetail> {
  return api.request({ path: `/me/leagues/${id(leagueId)}/player-market/${id(playerId)}?seasonId=${id(seasonId)}` })
}

export function listPlayerApplications(leagueId: string, options: PlayerApplicationListQuery): Promise<PlayerApplicationListResponse> {
  return api.request({ path: playerApplicationListPath(leagueId, options) })
}

export function listPlayerMarketAnnouncements(leagueId: string, options: PlayerMarketAnnouncementQuery): Promise<PlayerMarketAnnouncementListResponse> {
  return api.request({ path: query(`/me/leagues/${id(leagueId)}/player-market-announcements`, {
    seasonId: options.seasonId, cursor: options.cursor, limit: options.limit,
  }) })
}

export function submitPlayerApplication(leagueId: string, input: SubmitPlayerApplicationRequest, idempotencyKey: string): Promise<PlayerAcquisitionApplication> {
  return api.request({
    path: `/me/leagues/${id(leagueId)}/player-market-applications`, method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey }, data: input,
  })
}

export function amendPlayerApplication(applicationId: string, input: AmendPlayerApplicationRequest, idempotencyKey: string): Promise<PlayerAcquisitionApplication> {
  return api.request({
    path: `/me/player-market-applications/${id(applicationId)}`, method: 'PATCH',
    headers: { 'Idempotency-Key': idempotencyKey }, data: input,
  })
}

export function withdrawPlayerApplication(applicationId: string, input: WithdrawPlayerApplicationRequest, idempotencyKey: string): Promise<PlayerAcquisitionApplication> {
  return api.request({
    path: `/me/player-market-applications/${id(applicationId)}/withdraw`, method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey }, data: input,
  })
}
