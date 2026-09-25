import type { PlayerCardSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  buildPlayerQuery,
  groupCardsByPack,
  mergeUniqueCards,
  toCardViewModel,
} from './players.viewmodel'

const card = (overrides: Partial<PlayerCardSummary> = {}): PlayerCardSummary => ({
  id: '11111111-1111-4111-8111-111111111111',
  playerId: '22222222-2222-4222-8222-222222222222',
  playerNameZh: '亚历克西斯',
  playerNameEn: 'Alexis',
  cardName: '精选',
  position: 'CMF',
  overallRating: 96,
  cardType: 'FEATURED',
  playStyle: '指挥官',
  imageUrl: null,
  pack: null,
  publishedAt: '2026-09-24T12:00:00.000Z',
  ...overrides,
})

describe('player list view model', () => {
  it('omits empty filters and encodes a Chinese keyword exactly once', () => {
    expect(buildPlayerQuery({ keyword: '', position: undefined, limit: 20 }))
      .toBe('/players?limit=20')
    expect(buildPlayerQuery({ keyword: '梅西', limit: 20 }))
      .toBe('/players?keyword=%E6%A2%85%E8%A5%BF&limit=20')
  })

  it('drops the old cursor when a filter changes', () => {
    expect(buildPlayerQuery({ position: 'CF', cursor: 'old-cursor', limit: 20 }, { resetCursor: true }))
      .toBe('/players?position=CF&limit=20')
  })

  it('deduplicates repeated cards across pages while preserving first-seen order', () => {
    const first = card({ id: '11111111-1111-4111-8111-111111111111' })
    const second = card({ id: '22222222-2222-4222-8222-222222222222' })
    const third = card({ id: '33333333-3333-4333-8333-333333333333' })

    expect(mergeUniqueCards([first, second], [second, third]).map(({ id }) => id))
      .toEqual([first.id, second.id, third.id])
  })

  it('groups cards without a pack under 其他球员卡', () => {
    const groups = groupCardsByPack([
      card(),
      card({
        id: '33333333-3333-4333-8333-333333333333',
        pack: {
          id: '44444444-4444-4444-8444-444444444444',
          nameZh: '每周精选',
          nameEn: null,
          season: null,
          releaseDate: null,
          coverUrl: null,
        },
      }),
    ])

    expect(groups.map(({ title }) => title)).toEqual(['其他球员卡', '每周精选'])
  })

  it('builds owned fallback artwork when an image is absent', () => {
    expect(toCardViewModel(card())).toMatchObject({
      usesFallbackArtwork: true,
      fallbackInitials: '亚历',
      positionLabel: '中前卫',
      cardTypeLabel: '精选',
    })
  })
})
