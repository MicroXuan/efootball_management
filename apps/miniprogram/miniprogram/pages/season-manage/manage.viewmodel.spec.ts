import type { LeagueDetail, LeagueSeasonDetail, SeasonEntryResponse } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  buildSeasonForm,
  filterSeasonEntries,
  isRejectionReasonValid,
  managerTransitionAction,
  queueCounts,
  seasonManagerErrorMessage,
} from './manage.viewmodel'

const league = (): LeagueDetail => ({
  id: 'league-1', name: 'CELL传奇联赛', shortName: 'CELL', description: '', logoUrl: null,
  status: 'ACTIVE', defaultPlatform: 'MOBILE', defaultServerRegion: 'GLOBAL', defaultSuperCapacity: 23,
  defaultChampionCapacity: 18, defaultPromotionCount: 4, featuredSeason: null, version: 1,
  createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
  capabilities: { canManage: true, canCreateSeason: true },
})

const season = (status: LeagueSeasonDetail['status']): LeagueSeasonDetail => ({
  id: 'season-1', leagueId: 'league-1', seasonNumber: 1, displayName: 'CELL S1', previousSeasonId: null,
  isFirstSeason: true, registrationOpensAt: '2026-10-01T00:00:00.000Z', registrationClosesAt: '2026-10-08T00:00:00.000Z',
  startsAt: '2026-10-09T00:00:00.000Z', endsAt: '2026-11-09T00:00:00.000Z', superCapacity: 23,
  championCapacity: 18, promotionCount: 4, status, entryCount: 0, approvedEntryCount: 0, version: 1,
  createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z', currentEntry: null,
  capabilities: { canManage: true, canReviewEntries: true, canApply: false, canConfirmRenewal: false, canWithdraw: false },
})

const entry = (id: string, source: SeasonEntryResponse['source'], status: SeasonEntryResponse['status']): SeasonEntryResponse => ({
  id, seasonId: 'season-1', teamProfileId: `team-${id}`, leagueTeamId: `league-team-${id}`,
  ownerUserId: `user-${id}`, teamNumberSnapshot: Number(id), gameAccountId: `account-${id}`,
  source, status, previousSeasonEntryId: null, teamNameSnapshot: `球队${id}`, teamShortNameSnapshot: id,
  teamLogoUrlSnapshot: null, gamePlatformSnapshot: 'MOBILE', serverRegionSnapshot: 'GLOBAL', gamerTagSnapshot: `tag-${id}`,
  gameUidSnapshot: null, reviewedById: null, reviewedAt: null, decisionReason: null, confirmedAt: null,
  withdrawnAt: null, version: 1, createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
})

describe('season manager view model', () => {
  it('inherits league defaults into a new season form', () => {
    expect(buildSeasonForm(league(), 2)).toMatchObject({
      seasonNumber: 2, displayName: 'CELL S2', superCapacity: '23', championCapacity: '18', promotionCount: '4',
    })
  })

  it('shows only the supported registration transitions', () => {
    expect(managerTransitionAction(season('DRAFT'))).toEqual({ kind: 'OPEN', label: '开放报名' })
    expect(managerTransitionAction(season('REGISTRATION_OPEN'))).toEqual({ kind: 'CLOSE', label: '关闭报名' })
    expect(managerTransitionAction(season('ALLOCATION_REVIEW'))).toEqual({ kind: 'NEXT_PHASE', label: '下一阶段：分组确认' })
    expect(managerTransitionAction({ ...season('DRAFT'), capabilities: { ...season('DRAFT').capabilities, canManage: false } })).toBeNull()
  })

  it('filters the queue and counts renewal versus new applicants', () => {
    const entries = [entry('1', 'RENEWAL', 'INVITED'), entry('2', 'RENEWAL', 'APPROVED'), entry('3', 'NEW_APPLICATION', 'PENDING')]
    expect(filterSeasonEntries(entries, 'PENDING').map(({ id }) => id)).toEqual(['3'])
    expect(queueCounts(entries)).toEqual({ invitedRenewals: 1, confirmedRenewals: 1, newApplicants: 1 })
  })

  it('requires a rejection reason and refreshes on version conflict', () => {
    expect(isRejectionReasonValid('  ')).toBe(false)
    expect(isRejectionReasonValid('资料不完整')).toBe(true)
    expect(seasonManagerErrorMessage('VERSION_CONFLICT')).toMatchObject({ refresh: true })
  })
})
