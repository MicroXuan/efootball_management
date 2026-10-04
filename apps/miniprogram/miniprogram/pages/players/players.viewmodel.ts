import type {
  CardPackSummary,
  PlayerCardSummary,
  PlayerCardType,
  PlayerPosition,
  PlayerSearchQuery,
  PlayerSearchResponse,
} from '@efm/contracts'

export type PlayerQueryInput = Partial<Omit<PlayerSearchQuery, 'limit'>> & { limit?: number }

export type PlayerCardViewModel = PlayerCardSummary & {
  displayName: string
  positionLabel: string
  cardTypeLabel: string
  packName: string | null
  usesFallbackArtwork: boolean
  fallbackInitials: string
  isFavorite: boolean
}

export type PackOption = { value: string; label: string }

export type PlayerCardGroup = {
  id: string
  title: string
  cards: PlayerCardViewModel[]
}

export type PlayerPageState = {
  cards: PlayerCardSummary[]
  groups: PlayerCardGroup[]
  nextCursor: string | null
  hasMore: boolean
  releaseSequence: number | null
  errorMessage: string
}

const positionLabels: Record<PlayerPosition, string> = {
  GK: '门将',
  CB: '中后卫',
  LB: '左后卫',
  RB: '右后卫',
  DMF: '后腰',
  CMF: '中前卫',
  LMF: '左前卫',
  RMF: '右前卫',
  AMF: '前腰',
  LWF: '左边锋',
  RWF: '右边锋',
  SS: '影锋',
  CF: '中锋',
}

const cardTypeLabels: Record<PlayerCardType, string> = {
  STANDARD: '基础卡',
  FEATURED: '精选',
  TRENDING: '状态火热',
  HIGHLIGHT: '高光',
  EPIC: '史诗',
  BIG_TIME: '时刻',
  OTHER: '其他',
}

function fallbackInitials(name: string): string {
  if (/[^\u0000-\u00ff]/.test(name)) return [...name].slice(0, 2).join('')
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((word) => word[0]?.toLocaleUpperCase('en-US') ?? '').join('')
    || '球员'
}

export function buildPlayerQuery(
  query: PlayerQueryInput,
  options: { resetCursor?: boolean } = {},
): string {
  const values: Array<[string, string | number | undefined]> = [
    ['keyword', query.keyword?.trim() || undefined],
    ['position', query.position],
    ['minOverall', query.minOverall],
    ['maxOverall', query.maxOverall],
    ['cardType', query.cardType],
    ['cardPackId', query.cardPackId],
    ['cursor', options.resetCursor ? undefined : query.cursor],
    ['limit', query.limit ?? 20],
  ]
  const encoded = values
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
  return `/players${encoded ? `?${encoded}` : ''}`
}

export function mergeUniqueCards(
  current: PlayerCardSummary[],
  incoming: PlayerCardSummary[],
): PlayerCardSummary[] {
  const seen = new Set<string>()
  return [...current, ...incoming].filter(({ id }) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function toPackOptions(
  packs: Array<CardPackSummary & { cardCount: number }>,
): PackOption[] {
  return [
    { value: '', label: '全部球员包' },
    ...packs.map((pack) => ({
      value: pack.id,
      label: `${pack.nameZh ?? pack.nameEn ?? '未命名球员包'} · ${pack.cardCount} 张`,
    })),
  ]
}

export function favoriteLookup(
  cards: PlayerCardSummary[],
  favoritePlayerIds: string[],
): Record<string, boolean> {
  const favoriteIds = new Set(favoritePlayerIds)
  return Object.fromEntries(
    [...new Set(cards.map(({ playerId }) => playerId))].map((playerId) => [playerId, favoriteIds.has(playerId)]),
  )
}

export function isLatestPlayerRequest(
  activeToken: number,
  responseToken: number,
  unloaded: boolean,
): boolean {
  return !unloaded && activeToken === responseToken
}

export function toCardViewModel(
  card: PlayerCardSummary,
  favorites: Record<string, boolean> = {},
): PlayerCardViewModel {
  const displayName = card.playerNameZh ?? card.playerNameEn ?? '未知球员'
  return {
    ...card,
    displayName,
    positionLabel: positionLabels[card.position],
    cardTypeLabel: cardTypeLabels[card.cardType],
    packName: card.pack?.nameZh ?? card.pack?.nameEn ?? null,
    usesFallbackArtwork: !card.imageUrl,
    fallbackInitials: fallbackInitials(displayName),
    isFavorite: favorites[card.playerId] === true,
  }
}

export function groupCardsByPack(
  cards: PlayerCardSummary[],
  favorites: Record<string, boolean> = {},
): PlayerCardGroup[] {
  const groups = new Map<string, PlayerCardGroup>()
  for (const card of cards) {
    const id = card.pack?.id ?? 'other'
    const title = card.pack?.nameZh ?? card.pack?.nameEn ?? '其他球员卡'
    const group = groups.get(id) ?? { id, title, cards: [] }
    group.cards.push(toCardViewModel(card, favorites))
    groups.set(id, group)
  }
  return [...groups.values()]
}

export function nextPlayerPageState(
  current: PlayerPageState | undefined,
  result: PlayerSearchResponse | Error,
  mode: 'refresh' | 'append' | 'error',
): PlayerPageState {
  const previous = current ?? {
    cards: [],
    groups: [],
    nextCursor: null,
    hasMore: true,
    releaseSequence: null,
    errorMessage: '',
  }
  if (mode === 'error' || result instanceof Error) {
    return { ...previous, errorMessage: result instanceof Error ? result.message : '加载失败' }
  }
  const cards = mode === 'append'
    ? mergeUniqueCards(previous.cards, result.items)
    : result.items
  return {
    cards,
    groups: groupCardsByPack(cards),
    nextCursor: result.nextCursor,
    hasMore: Boolean(result.nextCursor),
    releaseSequence: result.releaseSequence,
    errorMessage: '',
  }
}
