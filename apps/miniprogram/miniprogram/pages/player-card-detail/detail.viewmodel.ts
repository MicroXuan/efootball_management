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

export type PlayerCardDetailViewModel = PlayerCardViewModel & {
  nationality: string | null
  club: string | null
  status: PlayerCardDetail['status']
  skills: PlayerCardDetail['skills']
  attributes: Array<{ key: string; label: string; value: number }>
  siblings: Array<{ id: string; title: string; overallRating: number }>
}

export function toCardDetailViewModel(detail: PlayerCardDetail): PlayerCardDetailViewModel {
  const known = new Map(attributeOrder.map((key, index) => [key, index]))
  const attributes = Object.entries(detail.attributes)
    .sort(([left], [right]) => {
      const leftOrder = known.get(left)
      const rightOrder = known.get(right)
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER)
      }
      return left.localeCompare(right, 'en-US')
    })
    .map(([key, value]) => ({ key, label: attributeLabels[key] ?? key, value }))

  return {
    ...toCardViewModel(detail),
    nationality: detail.nationality,
    club: detail.club,
    status: detail.status,
    skills: detail.skills,
    attributes,
    siblings: detail.otherCards.map((card) => ({
      id: card.id,
      title: card.cardName,
      overallRating: card.overallRating,
    })),
  }
}
