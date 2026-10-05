import type { PlayerCardDetail, PlayerCardSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  automaticBuildPanelState,
  favoriteMutationState,
  favoritePlayerId,
  playerCardPresentation,
  radarChartGeometry,
  radarVertices,
  toCardDetailViewModel,
} from './detail.viewmodel'

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
  autoBuild: null,
  ...overrides,
})

describe('player card detail view model', () => {
  it('keeps the base charts visible for finished cards before and after the action', () => {
    expect(automaticBuildPanelState(false, false)).toEqual({
      buttonLabel: '已是最终能力',
      note: '无需加点',
      showVisuals: true,
    })
    expect(automaticBuildPanelState(false, true)).toEqual({
      buttonLabel: '已是最终能力',
      note: '无需加点',
      showVisuals: true,
    })
  })

  it('keeps growth-card charts visible while applying and resetting its automatic build', () => {
    expect(automaticBuildPanelState(true, false)).toEqual({
      buttonLabel: '自动加点',
      note: '可自动加点',
      showVisuals: true,
    })
    expect(automaticBuildPanelState(true, true)).toEqual({
      buttonLabel: '重置加点',
      note: '已应用',
      showVisuals: true,
    })
  })

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
        cardType: '精选球员',
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

  it('presents the persisted automatic build with Chinese allocation labels', () => {
    const view = toCardDetailViewModel(detail({
      autoBuild: {
        allocation: { shooting: 8, passing: 4, dribbling: 12 },
        maxOverall: 101,
        dtRating: 99,
        algorithmVersion: 'pesdata-auto-v1',
      },
    }))

    expect(view.autoBuild).toEqual({
      available: true,
      maxOverall: 101,
      dtRating: 99,
      unavailableReason: '',
      allocationRows: [
        { key: 'shooting', label: '射门', points: 8 },
        { key: 'passing', label: '传球', points: 4 },
        { key: 'dribbling', label: '盘球', points: 12 },
      ],
    })
  })

  it('derives a PESDATA position build when legacy synced cards only contain progression points', () => {
    const view = toCardDetailViewModel(detail({
      position: 'RB',
      overallRating: 81,
      attributes: {
        sourceMetadata: { maxLevel: '76' },
      },
    }))

    expect(view.autoBuild).toEqual({
      available: true,
      maxOverall: 95,
      dtRating: null,
      unavailableReason: '',
      allocationRows: [
        { key: 'passing', label: '传球', points: 4 },
        { key: 'dribbling', label: '盘球', points: 4 },
        { key: 'dexterity', label: '灵巧', points: 8 },
        { key: 'lowerBodyStrength', label: '下肢力量', points: 16 },
        { key: 'aerialStrength', label: '空中力量', points: 4 },
        { key: 'defending', label: '防守', points: 8 },
      ],
    })
  })

  it('labels trending cards as finished cards instead of an unimplemented build', () => {
    const view = toCardDetailViewModel(detail({
      cardType: 'TRENDING',
      attributes: { sourceMetadata: { maxLevel: '0' } },
    }))

    expect(view.autoBuild).toMatchObject({
      available: false,
      unavailableReason: '状态火热卡为成品卡，无需分配成长点。',
    })
  })

  it('builds complete radar and position visuals from legacy PESDATA source metadata', () => {
    const sourceMetadata = {
      Speed: 87,
      Acceleration: 85,
      Finishing: 87,
      LowPass: 68,
      LoftedPass: 65,
      BallControl: 82,
      Dribbling: 83,
      TightPossession: 80,
      DefensiveAwareness: 46,
      Tackling: 43,
      Aggression: 60,
      DefensiveEngagement: 53,
      PhysicalContact: 87,
      KickingPower: 87,
      Jump: 75,
      Stamina: 84,
      Goalkeeping: 40,
    }
    const presentation = playerCardPresentation(detail({
      position: 'CF',
      overallRating: 97,
      cardType: 'TRENDING',
      attributes: { sourceMetadata },
    }), false)

    expect(presentation.radarMetrics.map(({ value }) => value)).toEqual([87, 67, 82, 87, 51, 83])
    expect(presentation.positions).toHaveLength(13)
    expect(presentation.positions.every(({ rating }) => rating !== null)).toBe(true)
    expect(presentation.positions.find(({ code }) => code === 'CF')?.rating).toBe(97)
    expect(presentation.positions.find(({ code }) => code === 'CB')?.rating).toBe(83)
    expect(presentation.positions.find(({ code }) => code === 'GK')?.rating).toBe(49)
  })

  it('uses Chinese labels for every PESDATA ability field shown in the panel', () => {
    const presentation = playerCardPresentation(detail({
      attributes: {
        sourceMetadata: {
          Aggression: 60,
          BallControl: 82,
          DefensiveAwareness: 46,
          gkCatching: 40,
          Heading: 75,
          LowPass: 68,
          PhysicalContact: 87,
          TightPossession: 80,
        },
      },
    }), false)

    expect(Object.fromEntries(presentation.attributes.map(({ key, label }) => [key, label])))
      .toMatchObject({
        aggression: '积极性',
        ballControl: '控球',
        defensiveAwareness: '防守意识',
        gkCatching: '守门员接球',
        heading: '头球',
        lowPass: '地面传球',
        physicalContact: '身体接触',
        tightPossession: '紧密控球',
      })
  })

  it('applies only persisted progression points to real numeric attributes', () => {
    const source = detail({
      overallRating: 88,
      attributes: { finishing: 74, passing: 80, dribbling: 81, speed: 78, defending: 70, physical: 83 },
      autoBuild: {
        allocation: { shooting: 8, passing: 4, dribbling: 12 },
        maxOverall: 101,
        dtRating: 99,
        algorithmVersion: 'pesdata-auto-v1',
      },
    })

    const base = playerCardPresentation(source, false)
    const applied = playerCardPresentation(source, true)
    expect(base.overallRating).toBe(88)
    expect(applied.overallRating).toBe(101)
    expect(Object.fromEntries(applied.attributes.map(({ key, value, delta }) => [key, [value, delta]])))
      .toMatchObject({ finishing: [82, 8], passing: [84, 4], dribbling: [93, 12], speed: [78, 0] })
    expect(applied.radarMetrics.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: '射门', value: 82 },
      { label: '传球', value: 84 },
      { label: '盘带', value: 93 },
      { label: '速度', value: 78 },
      { label: '防守', value: 70 },
      { label: '力量', value: 83 },
    ])
  })

  it('updates imported position ratings when automatic build is applied', () => {
    const source = detail({
      position: 'CF',
      overallRating: 88,
      attributes: {
        finishing: 74,
        passing: 80,
        dribbling: 81,
        speed: 78,
        defending: 70,
        physical: 83,
        positionRatings: { CF: 88, SS: 84, AMF: 82 },
      },
      autoBuild: {
        allocation: { shooting: 8, passing: 4, dribbling: 12 },
        maxOverall: 101,
        dtRating: 99,
        algorithmVersion: 'pesdata-auto-v1',
      },
    })

    const base = playerCardPresentation(source, false)
    const applied = playerCardPresentation(source, true)
    expect(base.positions.find(({ code }) => code === 'CF')?.rating).toBe(88)
    expect(applied.positions.find(({ code }) => code === 'CF')?.rating).toBe(101)
    expect(applied.positions.find(({ code }) => code === 'SS')?.rating)
      .toBeGreaterThan(base.positions.find(({ code }) => code === 'SS')?.rating ?? 0)
  })

  it('uses exact position ratings when imported and does not invent missing ratings', () => {
    const presentation = playerCardPresentation(detail({
      position: 'CMF',
      attributes: { positionRatings: { AMF: 94, CMF: 96 } },
      autoBuild: null,
    }), false)

    expect(presentation.positions.find(({ code }) => code === 'AMF')?.rating).toBe(94)
    expect(presentation.positions.find(({ code }) => code === 'CMF')?.rating).toBe(96)
    expect(presentation.positions.find(({ code }) => code === 'GK')?.rating).toBeNull()
    expect(presentation.positions).toHaveLength(13)
  })

  it('creates deterministic radar polygon vertices within the chart bounds', () => {
    expect(radarVertices([100, 100, 100, 100, 100, 100], 200, 200)).toEqual([
      { x: 100, y: 20 },
      { x: 169.28, y: 60 },
      { x: 169.28, y: 140 },
      { x: 100, y: 180 },
      { x: 30.72, y: 140 },
      { x: 30.72, y: 60 },
    ])
  })

  it('creates a layout-bound radar chart without relying on a native canvas', () => {
    const chart = radarChartGeometry([100, 75, 50, 25, 0, 60])

    expect(chart.polygon).toBe('50% 10%, 75.98% 35%, 67.32% 60%, 50% 60%, 50% 50%, 29.22% 38%')
    expect(chart.dots).toEqual([
      { key: 'point-0', style: 'left:50%;top:10%;' },
      { key: 'point-1', style: 'left:75.98%;top:35%;' },
      { key: 'point-2', style: 'left:67.32%;top:60%;' },
      { key: 'point-3', style: 'left:50%;top:60%;' },
      { key: 'point-4', style: 'left:50%;top:50%;' },
      { key: 'point-5', style: 'left:29.22%;top:38%;' },
    ])
    expect(chart.outline).toHaveLength(6)
    expect(chart.axes).toHaveLength(6)
    expect(chart.rings).toHaveLength(4)
    expect(chart.rings.every(({ segments }) => segments.length === 6)).toBe(true)
  })
})
