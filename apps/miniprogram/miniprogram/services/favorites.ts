import type {
  PlayerFavoriteListQuery,
  PlayerFavoriteListResponse,
  PlayerFavoriteStatusResponse,
} from '@efm/contracts'
import { api } from './api'

function queryPath(path: string, values: Record<string, string | number | undefined>): string {
  const query = Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return `${path}${query ? `?${query}` : ''}`
}

export const favoritesApi = {
  list(query: PlayerFavoriteListQuery) {
    return api.request<PlayerFavoriteListResponse>({
      path: queryPath('/me/player-favorites', query),
    })
  },

  favorite(playerId: string) {
    return api.request<PlayerFavoriteStatusResponse>({
      path: '/me/player-favorites',
      method: 'POST',
      data: { playerId },
    })
  },

  unfavorite(playerId: string) {
    return api.request<PlayerFavoriteStatusResponse>({
      path: `/me/player-favorites/${encodeURIComponent(playerId)}`,
      method: 'DELETE',
    })
  },

  statuses(playerIds: string[]) {
    return api.request<PlayerFavoriteStatusResponse>({
      path: queryPath('/me/player-favorites/status', { playerIds: [...new Set(playerIds)].join(',') }),
    })
  },
}
