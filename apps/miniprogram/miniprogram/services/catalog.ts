import type {
  CardPackDetail,
  CardPackListResponse,
  PlayerCardDetail,
  PlayerDetail,
  PlayerSearchResponse,
} from '@efm/contracts'
import { buildPlayerQuery, type PlayerQueryInput } from '../pages/players/players.viewmodel'
import { api } from './api'

function queryPath(path: string, values: Record<string, string | number | undefined>): string {
  const query = Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return `${path}${query ? `?${query}` : ''}`
}

export const catalogApi = {
  searchPlayers(query: PlayerQueryInput) {
    return api.request<PlayerSearchResponse>({ path: buildPlayerQuery(query) })
  },

  getPlayer(id: string) {
    return api.request<PlayerDetail>({ path: `/players/${encodeURIComponent(id)}` })
  },

  getPlayerCard(id: string) {
    return api.request<PlayerCardDetail>({
      path: `/player-cards/${encodeURIComponent(id)}`,
    })
  },

  listCardPacks(query: { cursor?: string; limit?: number } = {}) {
    return api.request<CardPackListResponse>({
      path: queryPath('/card-packs', { cursor: query.cursor, limit: query.limit ?? 20 }),
    })
  },

  getCardPack(id: string) {
    return api.request<CardPackDetail>({
      path: `/card-packs/${encodeURIComponent(id)}`,
    })
  },
}
