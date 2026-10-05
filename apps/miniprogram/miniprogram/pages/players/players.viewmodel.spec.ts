import type { PlayerCardSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  buildPlayerQuery,
  cardTypeOptions,
  groupCardsByPack,
  isLatestPlayerRequest,
  mergeUniqueCards,
  nextPlayerPageState,
  positionOptions,
  toPackOptions,
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

  it('adds and clears the selected player pack in the public catalog query', () => {
    const packId = '44444444-4444-4444-8444-444444444444'
    expect(buildPlayerQuery({ cardPackId: packId, limit: 20 }))
      .toBe(`/players?cardPackId=${packId}&limit=20`)
    expect(buildPlayerQuery({ cardPackId: undefined, limit: 20 }))
      .toBe('/players?limit=20')
  })

  it('creates a Chinese pack picker with an explicit clear option', () => {
    expect(toPackOptions([{
      id: '44444444-4444-4444-8444-444444444444',
      nameZh: '每周精选',
      nameEn: 'POTW',
      season: '2026',
      releaseDate: null,
      coverUrl: null,
      cardCount: 11,
    }])).toEqual([
      { value: '', label: '球员包' },
      { value: '44444444-4444-4444-8444-444444444444', label: '每周精选 · 11 张' },
    ])
  })

  it('offers every supported position and card type as explicit selector options', () => {
    expect(positionOptions).toEqual([
      { value: '', label: '位置' },
      ...['CF', 'SS', 'LWF', 'RWF', 'LMF', 'RMF', 'AMF', 'CMF', 'DMF', 'LB', 'RB', 'CB', 'GK']
        .map((value) => ({ value, label: value })),
    ])
    expect(cardTypeOptions).toEqual([
      { value: '', label: '球员类别' },
      { value: 'STANDARD', label: '普通球员' },
      { value: 'LEGENDARY', label: '普通传奇' },
      { value: 'EPIC', label: '史诗epic' },
      { value: 'BIG_TIME', label: 'BigTime' },
      { value: 'TRENDING', label: '状态火热' },
      { value: 'FEATURED', label: '精选球员' },
      { value: 'HIGHLIGHT', label: '高光球员' },
      { value: 'SHOW_TIME', label: 'ShowTime' },
    ])
  })

  it('accepts only the latest outstanding player request', () => {
    expect(isLatestPlayerRequest(8, 8, false)).toBe(true)
    expect(isLatestPlayerRequest(8, 7, false)).toBe(false)
    expect(isLatestPlayerRequest(8, 8, true)).toBe(false)
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
      cardTypeLabel: '精选球员',
    })
  })

  it('keeps the original PESDATA artwork URL so lists and details share the same cached image', () => {
    const original = 'https://img.pesdata.net/images/playerCard/52912386607527_l.webp'

    expect(toCardViewModel(card({ imageUrl: original })).imageUrl).toBe(original)
  })

  it('replaces on refresh, appends uniquely, stops at an empty cursor, and preserves content on error', () => {
    const initial = nextPlayerPageState(undefined, {
      items: [card()],
      nextCursor: 'next-1',
      releaseSequence: 1,
    }, 'refresh')
    const appended = nextPlayerPageState(initial, {
      items: [card(), card({ id: '33333333-3333-4333-8333-333333333333' })],
      nextCursor: null,
      releaseSequence: 1,
    }, 'append')
    const failed = nextPlayerPageState(appended, new Error('网络连接失败'), 'error')

    expect(initial.cards).toHaveLength(1)
    expect(appended.cards).toHaveLength(2)
    expect(appended.hasMore).toBe(false)
    expect(failed.cards).toEqual(appended.cards)
    expect(failed.errorMessage).toBe('网络连接失败')
  })
})
