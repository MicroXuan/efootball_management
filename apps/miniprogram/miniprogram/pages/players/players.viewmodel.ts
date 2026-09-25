import type {
  PlayerCardSummary,
  PlayerCardType,
  PlayerPosition,
  PlayerSearchQuery,
} from '@efm/contracts'

export type PlayerQueryInput = Partial<Omit<PlayerSearchQuery, 'limit'>> & { limit?: number }

export type PlayerCardViewModel = PlayerCardSummary & {
  displayName: string
  positionLabel: string
  cardTypeLabel: string
  packName: string | null
  usesFallbackArtwork: boolean
  fallbackInitials: string
}

export type PlayerCardGroup = {
  id: string
  title: string
  cards: PlayerCardViewModel[]
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

export function toCardViewModel(card: PlayerCardSummary): PlayerCardViewModel {
  const displayName = card.playerNameZh ?? card.playerNameEn ?? '未知球员'
  return {
    ...card,
    displayName,
    positionLabel: positionLabels[card.position],
    cardTypeLabel: cardTypeLabels[card.cardType],
    packName: card.pack?.nameZh ?? card.pack?.nameEn ?? null,
    usesFallbackArtwork: !card.imageUrl,
    fallbackInitials: fallbackInitials(displayName),
  }
}

export function groupCardsByPack(cards: PlayerCardSummary[]): PlayerCardGroup[] {
  const groups = new Map<string, PlayerCardGroup>()
  for (const card of cards) {
    const id = card.pack?.id ?? 'other'
    const title = card.pack?.nameZh ?? card.pack?.nameEn ?? '其他球员卡'
    const group = groups.get(id) ?? { id, title, cards: [] }
    group.cards.push(toCardViewModel(card))
    groups.set(id, group)
  }
  return [...groups.values()]
}
