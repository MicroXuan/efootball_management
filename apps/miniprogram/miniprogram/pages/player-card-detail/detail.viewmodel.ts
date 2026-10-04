import type { PlayerCardDetail } from '@efm/contracts'
import { toCardViewModel, type PlayerCardViewModel } from '../players/players.viewmodel'

const attributeOrder = [
  'overall',
  'speed',
  'acceleration',
  'finishing',
  'passing',
  'dribbling',
  'defending',
  'physical',
  'stamina',
  'goalkeeping',
]

const attributeLabels: Record<string, string> = {
  overall: '总评',
  speed: '速度',
  acceleration: '加速',
  finishing: '射门',
  passing: '传球',
  dribbling: '盘带',
  defending: '防守',
  physical: '身体',
  stamina: '体力',
  goalkeeping: '守门',
}

const profileAttributeKeys = new Set([
  'age',
  'height',
  'heightCm',
  'preferredFoot',
  'foot',
  'atRating',
  'at',
])

export type PlayerProfileFact = {
  key: string
  label: string
  value: string
  wide?: boolean
}

export type PlayerCardDetailViewModel = PlayerCardViewModel & {
  nationality: string | null
  club: string | null
  status: PlayerCardDetail['status']
  skills: PlayerCardDetail['skills']
  profileFacts: PlayerProfileFact[]
  attributes: Array<{
    key: string
    label: string
    value: number
    tone: 'elite' | 'standard'
    barWidth: number
  }>
  siblings: Array<{
    id: string
    title: string
    overallRating: number
    positionLabel: string
    cardTypeLabel: string
  }>
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function recordedNumber(value: unknown): string {
  const number = finiteNumber(value)
  return number === null ? '未记录' : String(number)
}

function preferredFoot(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '未记录'
  const normalized = value.trim().toLocaleUpperCase('en-US')
  const labels: Record<string, string> = {
    LEFT: '左脚',
    L: '左脚',
    RIGHT: '右脚',
    R: '右脚',
    BOTH: '双足',
  }
  return labels[normalized] ?? value.trim()
}

function displayDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, '.')
}

function buildProfileFacts(detail: PlayerCardDetail, card: PlayerCardViewModel): PlayerProfileFact[] {
  const age = finiteNumber(detail.attributes.age)
  const height = finiteNumber(detail.attributes.heightCm ?? detail.attributes.height)
  const packName = card.packName
    ? [card.packName, detail.pack?.season].filter(Boolean).join(' · ')
    : '未记录'

  return [
    { key: 'position', label: '位置', value: card.positionLabel },
    { key: 'nationality', label: '国籍', value: detail.nationality ?? '未记录' },
    { key: 'club', label: '俱乐部', value: detail.club ?? '未记录', wide: true },
    { key: 'age', label: '年龄', value: age === null ? '未记录' : `${age} 岁` },
    { key: 'height', label: '身高', value: height === null ? '未记录' : `${height} cm` },
    {
      key: 'foot',
      label: '惯用脚',
      value: preferredFoot(detail.attributes.preferredFoot ?? detail.attributes.foot),
    },
    {
      key: 'atRating',
      label: 'AT 评分',
      value: recordedNumber(detail.attributes.atRating ?? detail.attributes.at),
    },
    { key: 'playStyle', label: '比赛风格', value: detail.playStyle ?? '未记录', wide: true },
    { key: 'cardType', label: '卡片类型', value: card.cardTypeLabel },
    { key: 'pack', label: '球员包', value: packName, wide: true },
    { key: 'publishedAt', label: '发布日期', value: displayDate(detail.publishedAt) },
    { key: 'status', label: '卡片状态', value: detail.status === 'ACTIVE' ? '可用' : '已下架' },
  ]
}

export function toCardDetailViewModel(detail: PlayerCardDetail): PlayerCardDetailViewModel {
  const card = toCardViewModel(detail)
  const known = new Map(attributeOrder.map((key, index) => [key, index]))
  const attributes = Object.entries(detail.attributes)
    .filter((entry): entry is [string, number] => (
      !profileAttributeKeys.has(entry[0])
      && typeof entry[1] === 'number'
      && Number.isFinite(entry[1])
    ))
    .sort(([left], [right]) => {
      const leftOrder = known.get(left)
      const rightOrder = known.get(right)
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER)
      }
      return left.localeCompare(right, 'en-US')
    })
    .map(([key, value]) => ({
      key,
      label: attributeLabels[key] ?? key,
      value,
      tone: value >= 90 ? 'elite' as const : 'standard' as const,
      barWidth: Math.min(100, Math.max(0, value)),
    }))

  return {
    ...card,
    nationality: detail.nationality,
    club: detail.club,
    status: detail.status,
    skills: detail.skills,
    profileFacts: buildProfileFacts(detail, card),
    attributes,
    siblings: detail.otherCards.map((sibling) => {
      const siblingCard = toCardViewModel(sibling)
      return {
        id: sibling.id,
        title: sibling.cardName,
        overallRating: sibling.overallRating,
        positionLabel: siblingCard.positionLabel,
        cardTypeLabel: siblingCard.cardTypeLabel,
      }
    }),
  }
}

export function favoritePlayerId(card: PlayerCardDetailViewModel): string {
  return card.playerId
}

export function favoriteMutationState(
  current: boolean,
  succeeded: boolean,
  next: boolean,
): boolean {
  return succeeded ? next : current
}
