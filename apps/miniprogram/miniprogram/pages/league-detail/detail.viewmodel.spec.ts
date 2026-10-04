import type { LeagueSeasonSummary, LeagueWorkspaceResponse, SeasonEntryResponse } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  entryStatusCopy,
  leagueDetailErrorMessage,
  seasonRailSteps,
  seasonStructureCopy,
  selectSeason,
  standingsAccess,
  workspaceSummary,
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
  id: 'entry-1', seasonId: 'season-1', teamProfileId: 'profile-1', leagueTeamId: 'league-team-1',
  ownerUserId: 'user-1', teamNumberSnapshot: 7,
  gameAccountId: 'account-1', source: status === 'INVITED' ? 'RENEWAL' : 'NEW_APPLICATION', status,
  previousSeasonEntryId: null, teamNameSnapshot: '申花', teamShortNameSnapshot: '申花',
  teamLogoUrlSnapshot: null, gamePlatformSnapshot: 'MOBILE', serverRegionSnapshot: 'GLOBAL',
  gamerTagSnapshot: 'Dust', gameUidSnapshot: null, reviewedById: null, reviewedAt: null,
  leagueEditionSnapshot: 'NATIONAL',
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

  it('renders read-only enrollment state without self-service actions', () => {
    expect(entryStatusCopy(false, false, null)).toBe('登录后查看管理员分配的联赛球队')
    expect(entryStatusCopy(true, false, null)).toBe('请联系联赛管理员分配球队')
    expect(entryStatusCopy(true, true, null)).toBe('当前赛季尚未入组')
    expect(entryStatusCopy(true, true, entry('APPROVED'))).toBe('已报名当前赛季')
    expect(entryStatusCopy(true, true, entry('PENDING'))).toBe('等待管理员确认')
  })

  it('localizes read failures', () => {
    expect(leagueDetailErrorMessage('VERSION_CONFLICT')).toBe('赛季或报名状态已变更，请刷新后重试')
  })

  it('opens private standings only to an approved season entry', () => {
    expect(standingsAccess(entry('APPROVED'))).toEqual({
      enabled: true,
      label: '查看分组积分榜',
      hint: '查看各组实时排名与比赛数据',
    })
    expect(standingsAccess(entry('PENDING'))).toEqual({
      enabled: false,
      label: '报名后开放',
      hint: '仅当前赛季正式参赛球队可查看',
    })
    expect(standingsAccess(null).enabled).toBe(false)
  })

  it('presents enrolled workspace data and stable empty states', () => {
    const workspace: LeagueWorkspaceResponse = {
      leagueId: 'league-1', seasonId: 'season-1', team: { leagueTeamId: 'team-1', name: '海港', shortName: '海港', logoUrl: null },
      division: { stageId: 'stage-a', stageCode: 'CHAMPION_A', displayName: '冠军 A 组' },
      currentRank: { rank: 2, points: 13, played: 6, tiePending: true },
      nextMatch: { id: 'match-1', roundNumber: 7, plannedAt: null, opponentName: '申花', side: 'HOME' },
      capabilities: { canViewStandings: true, canViewAssets: true, canViewFinance: true, canManageValuations: true },
    }
    expect(workspaceSummary(workspace)).toMatchObject({ divisionName: '冠军 A 组', rank: '2*', nextMatch: '第 7 轮 · 对阵 申花', nextMatchTime: '时间待定' })
    expect(workspaceSummary({ ...workspace, division: null, currentRank: null, nextMatch: null })).toMatchObject({ divisionName: '等待正式分组', rank: '—', nextMatch: '暂无待进行比赛' })
  })

  it.each([
    ['DRAFT', ['current', 'upcoming', 'upcoming', 'upcoming']],
    ['REGISTRATION_OPEN', ['current', 'upcoming', 'upcoming', 'upcoming']],
    ['ALLOCATION_REVIEW', ['complete', 'current', 'upcoming', 'upcoming']],
    ['READY', ['complete', 'complete', 'current', 'upcoming']],
    ['IN_PROGRESS', ['complete', 'complete', 'current', 'upcoming']],
    ['COMPLETED', ['complete', 'complete', 'complete', 'complete']],
    ['CANCELLED', ['cancelled', 'cancelled', 'cancelled', 'cancelled']],
  ] as const)('maps %s to a four-stage season rail', (status, states) => {
    const steps = seasonRailSteps(status)

    expect(steps.map((step) => step.label)).toEqual(['报名', '确认', '赛程', '结算'])
    expect(steps.map((step) => step.state)).toEqual(states)
  })
})
