import type { LeagueSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { leagueCardView, leagueListErrorMessage, seasonStatusLabel } from './leagues.viewmodel'

const league = (overrides: Partial<LeagueSummary> = {}): LeagueSummary => ({
  id: 'league-1',
  name: 'CELL传奇联赛',
  shortName: 'CELL',
  description: '国内实况联赛',
  logoUrl: null,
  status: 'ACTIVE',
  defaultPlatform: 'MOBILE',
  defaultServerRegion: 'GLOBAL',
  defaultSuperCapacity: 23,
  defaultChampionCapacity: 18,
  defaultPromotionCount: 4,
  featuredSeason: null,
  version: 1,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  ...overrides,
})

describe('league list view model', () => {
  it('formats registration and upcoming season states', () => {
    expect(seasonStatusLabel('REGISTRATION_OPEN')).toBe('报名中')
    expect(seasonStatusLabel('READY')).toBe('即将开赛')
    expect(seasonStatusLabel('IN_PROGRESS')).toBe('进行中')
  })

  it('builds a brand card with platform, region, and season copy', () => {
    const card = leagueCardView(league({
      featuredSeason: {
        id: 'season-1', leagueId: 'league-1', seasonNumber: 1, displayName: 'CELL S20',
        previousSeasonId: null, isFirstSeason: true,
        registrationOpensAt: '2026-09-01T00:00:00.000Z', registrationClosesAt: '2026-09-08T00:00:00.000Z',
        startsAt: '2026-09-09T00:00:00.000Z', endsAt: '2026-10-09T00:00:00.000Z',
        superCapacity: 23, championCapacity: 18, promotionCount: 4,
        status: 'REGISTRATION_OPEN', entryCount: 18, approvedEntryCount: 12, version: 1,
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      },
    }))
    expect(card).toMatchObject({ seasonName: 'CELL S20', seasonState: '报名中', eligibility: '移动端 · GLOBAL' })
  })

  it('provides actionable list error copy', () => {
    expect(leagueListErrorMessage('NETWORK_ERROR')).toBe('网络连接失败，下拉或点击重试')
  })
})
