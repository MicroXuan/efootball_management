import type { GameAccountResponse, LeagueSeasonSummary, SeasonEntryResponse, TeamProfileResponse } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  defaultSeasonAccountId,
  deriveSeasonAction,
  leagueDetailErrorMessage,
  seasonStructureCopy,
  selectSeason,
} from './detail.viewmodel'

const season = (overrides: Partial<LeagueSeasonSummary> = {}): LeagueSeasonSummary => ({
  id: 'season-1', leagueId: 'league-1', seasonNumber: 1, displayName: 'S1', previousSeasonId: null,
  isFirstSeason: true, registrationOpensAt: '2026-09-01T00:00:00.000Z',
  registrationClosesAt: '2026-09-08T00:00:00.000Z', startsAt: '2026-09-09T00:00:00.000Z',
  endsAt: '2026-10-09T00:00:00.000Z', superCapacity: 23, championCapacity: 18,
  promotionCount: 4, status: 'REGISTRATION_OPEN', entryCount: 0, approvedEntryCount: 0,
  version: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

const entry = (status: SeasonEntryResponse['status']): SeasonEntryResponse => ({
  id: 'entry-1', seasonId: 'season-1', teamProfileId: 'profile-1', ownerUserId: 'user-1',
  gameAccountId: 'account-1', source: status === 'INVITED' ? 'RENEWAL' : 'NEW_APPLICATION', status,
  previousSeasonEntryId: null, teamNameSnapshot: '申花', teamShortNameSnapshot: '申花',
  teamLogoUrlSnapshot: null, gamePlatformSnapshot: 'MOBILE', serverRegionSnapshot: 'GLOBAL',
  gamerTagSnapshot: 'Dust', gameUidSnapshot: null, reviewedById: null, reviewedAt: null,
  decisionReason: null, confirmedAt: null, withdrawnAt: null, version: 1,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})

describe('league detail view model', () => {
  it('selects a requested season or falls back to the newest season', () => {
    const seasons = [season({ id: 'season-2', seasonNumber: 2 }), season()]
    expect(selectSeason(seasons, 'season-1')?.id).toBe('season-1')
    expect(selectSeason(seasons, 'missing')?.id).toBe('season-2')
  })

  it('explains first and later season structures without fake standings', () => {
    expect(seasonStructureCopy(season())).toBe('首赛季仅设冠军组，超级组将由本赛季排名产生')
    expect(seasonStructureCopy(season({ seasonNumber: 2, isFirstSeason: false }))).toBe('本赛季包含超级组与冠军组，分组由管理员确认')
  })

  it('derives team setup, application, renewal, and status actions', () => {
    expect(deriveSeasonAction(false, null, 'REGISTRATION_OPEN', false)).toMatchObject({ kind: 'LOGIN', label: '登录后报名' })
    expect(deriveSeasonAction(false, null, 'REGISTRATION_OPEN')).toMatchObject({ kind: 'TEAM_PROFILE', label: '先建立球队档案' })
    expect(deriveSeasonAction(true, null, 'REGISTRATION_OPEN')).toMatchObject({ kind: 'APPLY', label: '报名参加' })
    expect(deriveSeasonAction(true, entry('INVITED'), 'REGISTRATION_OPEN')).toMatchObject({ kind: 'RENEW', label: '确认参加下一赛季' })
    expect(deriveSeasonAction(true, entry('PENDING'), 'REGISTRATION_OPEN')).toMatchObject({ kind: 'WITHDRAW', label: '审核中 · 撤回报名' })
    expect(deriveSeasonAction(true, entry('APPROVED'), 'ALLOCATION_REVIEW')).toMatchObject({ kind: 'NONE', label: '已通过审核' })
  })

  it('defaults account selection to the team profile account and localizes conflicts', () => {
    const profile = { defaultGameAccountId: 'account-2' } as TeamProfileResponse
    const accounts = [{ id: 'account-1' }, { id: 'account-2' }] as GameAccountResponse[]
    expect(defaultSeasonAccountId(profile, accounts)).toBe('account-2')
    expect(leagueDetailErrorMessage('VERSION_CONFLICT')).toBe('赛季或报名状态已变更，请刷新后重试')
  })
})
