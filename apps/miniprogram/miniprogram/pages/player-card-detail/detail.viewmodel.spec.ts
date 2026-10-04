import type { PlayerCardDetail, PlayerCardSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { favoriteMutationState, favoritePlayerId, toCardDetailViewModel } from './detail.viewmodel'

const sibling: PlayerCardSummary = {
  id: '33333333-3333-4333-8333-333333333333',
  playerId: '22222222-2222-4222-8222-222222222222',
  playerNameZh: '亚历克西斯',
  playerNameEn: 'Alexis',
  cardName: '基础卡',
  position: 'CMF',
  overallRating: 90,
  cardType: 'STANDARD',
  playStyle: null,
  imageUrl: null,
  pack: null,
  publishedAt: '2026-09-24T12:00:00.000Z',
}

const detail = (overrides: Partial<PlayerCardDetail> = {}): PlayerCardDetail => ({
  ...sibling,
  id: '11111111-1111-4111-8111-111111111111',
  cardName: '精选',
  overallRating: 96,
  cardType: 'FEATURED',
  nationality: null,
  club: null,
  status: 'ACTIVE',
  skills: [],
  attributes: { speed: 94, passing: 96, zebra: 1, agility: 92 },
  otherCards: [sibling],
  ...overrides,
})

describe('player card detail view model', () => {
  it('builds a Chinese scouting profile from card and imported physical metadata', () => {
    const view = toCardDetailViewModel(detail({
      nationality: '阿根廷',
      club: '迈阿密国际',
      playStyle: '创意指挥官',
      pack: {
        id: '44444444-4444-4444-8444-444444444444',
        nameZh: 'POTW 26',
        nameEn: null,
        season: '2026',
        releaseDate: '2026-09-20',
        coverUrl: null,
      },
      attributes: {
        age: 39,
        heightCm: 170,
        preferredFoot: 'LEFT',
        atRating: 103,
        speed: 94,
        passing: 96,
      },
    }))

    expect(Object.fromEntries(view.profileFacts.map(({ key, value }) => [key, value])))
      .toEqual({
        position: '中前卫',
        nationality: '阿根廷',
        club: '迈阿密国际',
        age: '39 岁',
        height: '170 cm',
        foot: '左脚',
        atRating: '103',
        playStyle: '创意指挥官',
        cardType: '精选',
        pack: 'POTW 26 · 2026',
        publishedAt: '2026.09.24',
        status: '可用',
      })
    expect(view.attributes.map(({ key }) => key)).toEqual(['speed', 'passing'])
  })

  it('makes elite ratings distinct and safely caps their visual bar width', () => {
    const view = toCardDetailViewModel(detail({
      attributes: { finishing: 104, speed: 94, stamina: 89 },
    }))

    expect(view.attributes).toEqual([
      expect.objectContaining({ key: 'speed', value: 94, tone: 'elite', barWidth: 94 }),
      expect.objectContaining({ key: 'finishing', value: 104, tone: 'elite', barWidth: 100 }),
      expect.objectContaining({ key: 'stamina', value: 89, tone: 'standard', barWidth: 89 }),
    ])
  })

  it('uses explicit Chinese fallbacks when scouting metadata is missing', () => {
    const facts = Object.fromEntries(
      toCardDetailViewModel(detail()).profileFacts.map(({ key, value }) => [key, value]),
    )

    expect(facts).toMatchObject({
      nationality: '未记录',
      club: '未记录',
      age: '未记录',
      height: '未记录',
      foot: '未记录',
      atRating: '未记录',
      playStyle: '未记录',
      pack: '未记录',
    })
  })

  it('uses fixed attribute order and appends unknown keys alphabetically', () => {
    expect(toCardDetailViewModel(detail()).attributes.map(({ key }) => key))
      .toEqual(['speed', 'passing', 'agility', 'zebra'])
  })

  it('keeps nullable metadata, empty skills, fallback art, and sibling navigation', () => {
    expect(toCardDetailViewModel(detail())).toMatchObject({
      nationality: null,
      club: null,
      skills: [],
      usesFallbackArtwork: true,
      siblings: [{ id: sibling.id, title: '基础卡', overallRating: 90 }],
    })
  })

  it('renders only finite numeric metadata as attribute bars', () => {
    const attributes = {
      speed: 77,
      foot: 'RIGHT',
      positionHot: ['CB', 'DMF'],
      boost: { Tackling: 2 },
      invalid: Number.POSITIVE_INFINITY,
    } as unknown as PlayerCardDetail['attributes']

    expect(toCardDetailViewModel(detail({ attributes })).attributes).toEqual([
      expect.objectContaining({ key: 'speed', value: 77 }),
    ])
  })

  it('targets the player id and preserves favorite state when a mutation fails', () => {
    const view = toCardDetailViewModel(detail())
    expect(favoritePlayerId(view)).toBe(sibling.playerId)
    expect(favoriteMutationState(true, false, false)).toBe(true)
    expect(favoriteMutationState(true, true, false)).toBe(false)
  })
})
