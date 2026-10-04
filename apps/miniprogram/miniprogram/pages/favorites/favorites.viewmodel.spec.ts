import type { PlayerFavoriteItem } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  buildFavoriteQuery,
  favoritePageCopy,
  nextFavoritePageState,
} from './favorites.viewmodel'

const item = (playerId: string, cardId: string): PlayerFavoriteItem => ({
  playerId,
  favoritedAt: '2026-10-03T00:00:00.000Z',
  card: {
    id: cardId,
    playerId,
    playerNameZh: '梅西',
    playerNameEn: 'Lionel Messi',
    cardName: '蓝白传奇',
    position: 'AMF',
    overallRating: 99,
    cardType: 'EPIC',
    playStyle: null,
    imageUrl: null,
    pack: null,
    publishedAt: '2026-09-01T00:00:00.000Z',
  },
})

describe('favorite page view model', () => {
  it('replaces on refresh and appends without duplicating a player', () => {
    const playerA = '11111111-1111-4111-8111-111111111111'
    const playerB = '22222222-2222-4222-8222-222222222222'
    const first = nextFavoritePageState(undefined, {
      items: [item(playerA, '33333333-3333-4333-8333-333333333333')],
      nextCursor: 'next',
    }, 'refresh')
    const appended = nextFavoritePageState(first, {
      items: [
        item(playerA, '44444444-4444-4444-8444-444444444444'),
        item(playerB, '55555555-5555-4555-8555-555555555555'),
      ],
      nextCursor: null,
    }, 'append')

    expect(appended.items.map(({ playerId }) => playerId)).toEqual([playerA, playerB])
    expect(appended.cards.map(({ id }) => id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '55555555-5555-4555-8555-555555555555',
    ])
    expect(appended.hasMore).toBe(false)
  })

  it('trims search and drops the old cursor for a fresh search', () => {
    expect(buildFavoriteQuery({ keyword: '  梅西  ', cursor: 'old', limit: 20 }, true))
      .toEqual({ keyword: '梅西', limit: 20 })
  })

  it('keeps explicit Chinese empty and error states', () => {
    expect(favoritePageCopy('empty')).toEqual({ title: '还没有收藏球员', detail: '在球员档案或卡片详情中点击收藏，这里会自动展示该球员当前最强卡片。' })
    expect(favoritePageCopy('error')).toEqual({ title: '收藏列表加载失败', detail: '请检查网络后重试。' })
  })
})
