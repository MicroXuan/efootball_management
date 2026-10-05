import type {
  PlayerFavoriteItem,
  PlayerFavoriteListQuery,
  PlayerFavoriteListResponse,
} from '@efm/contracts'
import { toCardViewModel, type PlayerCardViewModel } from '../players/players.viewmodel'

export type FavoritePageState = {
  items: PlayerFavoriteItem[]
  cards: PlayerCardViewModel[]
  nextCursor: string | null
  hasMore: boolean
  errorMessage: string
}

export function buildFavoriteQuery(
  query: PlayerFavoriteListQuery,
  resetCursor = false,
): PlayerFavoriteListQuery {
  return {
    ...(query.keyword?.trim() ? { keyword: query.keyword.trim() } : {}),
    ...(!resetCursor && query.cursor ? { cursor: query.cursor } : {}),
    limit: query.limit,
  }
}

function mergeItems(
  current: PlayerFavoriteItem[],
  incoming: PlayerFavoriteItem[],
): PlayerFavoriteItem[] {
  const seen = new Set<string>()
  return [...current, ...incoming].filter(({ playerId }) => {
    if (seen.has(playerId)) return false
    seen.add(playerId)
    return true
  })
}

export function nextFavoritePageState(
  current: FavoritePageState | undefined,
  response: PlayerFavoriteListResponse,
  mode: 'refresh' | 'append',
): FavoritePageState {
  const items = mode === 'append'
    ? mergeItems(current?.items ?? [], response.items)
    : response.items
  return {
    items,
    cards: items.map(({ card }) => toCardViewModel(card)),
    nextCursor: response.nextCursor,
    hasMore: Boolean(response.nextCursor),
    errorMessage: '',
  }
}

export function favoritePageCopy(kind: 'empty' | 'error'): { title: string; detail: string } {
  return kind === 'empty'
    ? { title: '还没有收藏球员', detail: '在球员档案或卡片详情中点击收藏，这里会自动展示该球员当前最强卡片。' }
    : { title: '收藏列表加载失败', detail: '请检查网络后重试。' }
}
