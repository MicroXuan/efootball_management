import type {
  PlayerFavoriteListQuery,
  PlayerFavoriteListResponse,
  PlayerFavoriteStatusResponse,
  PlayerFavoriteGroup,
  PlayerFavoriteGroupsResponse,
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

  groups() {
    return api.request<PlayerFavoriteGroupsResponse>({ path: '/me/player-favorites/groups' })
  },

  createGroup(name: string) {
    return api.request<PlayerFavoriteGroup>({ path: '/me/player-favorites/groups', method: 'POST', data: { name } })
  },

  deleteGroup(groupId: string) {
    return api.request<{ deleted: boolean }>({
      path: `/me/player-favorites/groups/${encodeURIComponent(groupId)}`, method: 'DELETE',
    })
  },

  move(playerId: string, groupId: string | null) {
    return api.request<{ playerId: string; groupId: string | null }>({
      path: `/me/player-favorites/${encodeURIComponent(playerId)}/group`, method: 'PATCH', data: { groupId },
    })
  },
}
