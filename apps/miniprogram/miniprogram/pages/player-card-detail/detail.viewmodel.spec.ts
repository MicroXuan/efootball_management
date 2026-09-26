import type { PlayerCardDetail, PlayerCardSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { toCardDetailViewModel } from './detail.viewmodel'

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
})
