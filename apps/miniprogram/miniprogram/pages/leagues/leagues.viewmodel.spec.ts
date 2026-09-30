import type { LeagueSummary, MyLeagueTeamSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { leagueCardView, leagueListErrorMessage, myLeagueCardView, selectLeagueCards, seasonStatusLabel } from './leagues.viewmodel'

const league = (overrides: Partial<LeagueSummary> = {}): LeagueSummary => ({
  id: 'league-1', name: 'CELL传奇联赛', shortName: 'CELL', description: '国内实况联赛', logoUrl: null,
  status: 'ACTIVE', edition: 'NATIONAL', defaultSuperCapacity: 23, defaultChampionCapacity: 18,
  defaultPromotionCount: 4, currentSeason: null, version: 1,
  createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z', ...overrides,
})

const mine = (overrides: Partial<MyLeagueTeamSummary> = {}): MyLeagueTeamSummary => ({
  id: 'team-1', leagueId: 'league-1', ownerUserId: 'user-1', ownerPublicUserNo: '000123', teamNumber: 25,
  name: '上海申花', shortName: '申花', logoUrl: null, status: 'ACTIVE', activePlayerCount: 0,
  salaryTotalMinor: 0, salaryCapMinor: 0, rosterStatus: 'COMPLIANT', version: 1,
  createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
  leagueName: 'CELL传奇联赛', leagueDescription: '国内实况联赛', leagueLogoUrl: null,
  leagueEdition: 'INTERNATIONAL', currentSeason: null, ...overrides,
})

describe('league list view model', () => {
  it('formats current season, edition, and live approved participant copy', () => {
    const card = leagueCardView(league({ currentSeason: {
      id: 'season-1', displayName: 'CELL S20', status: 'REGISTRATION_OPEN', approvedEntryCount: 12,
    } }))
    expect(card).toMatchObject({
      displayName: 'CELL传奇联赛', seasonName: 'CELL S20', seasonState: '报名中',
      editionLabel: '国服', entryCopy: '12 支球队参赛', logoText: 'CE',
    })
  })

  it('builds my-league cards from bound teams with safe fallbacks', () => {
    const card = myLeagueCardView(mine({ leagueName: '', leagueDescription: '', currentSeason: null }))
    expect(card).toMatchObject({
      id: 'league-1', displayName: '未命名联赛', editionLabel: '国际服', seasonName: '暂无当前赛季',
      entryCopy: '等待管理员设置赛季', teamName: '上海申花', logoText: '申花',
    })
  })

  it('selects all or user-bound leagues without mixing the sources', () => {
    const all = [leagueCardView(league())]
    const bound = [myLeagueCardView(mine({ leagueId: 'league-2', leagueName: '我的联赛' }))]
    expect(selectLeagueCards('all', all, bound)).toEqual(all)
    expect(selectLeagueCards('mine', all, bound)).toEqual(bound)
  })

  it('formats season states and actionable errors', () => {
    expect(seasonStatusLabel('IN_PROGRESS')).toBe('进行中')
    expect(leagueListErrorMessage('NETWORK_ERROR')).toBe('网络连接失败，下拉或点击重试')
  })
})
