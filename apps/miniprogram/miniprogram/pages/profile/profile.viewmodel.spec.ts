import type { CurrentUserResponse, MyLeagueTeamSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { profileView } from './profile.viewmodel'

const user: CurrentUserResponse = {
  id: 'user-1', publicUserNo: '000123', displayName: 'Dust', avatarUrl: null, region: null, status: 'ACTIVE', profileComplete: false,
}
const team: MyLeagueTeamSummary = {
  id: 'team-1', leagueId: 'league-1', ownerUserId: 'user-1', ownerPublicUserNo: '000123', teamNumber: 25,
  name: '上海申花', shortName: '申花', logoUrl: null, status: 'ACTIVE', activePlayerCount: 3,
  salaryTotalMinor: 600, salaryCapMinor: 2000, rosterStatus: 'COMPLIANT', version: 1,
  createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
  leagueName: 'CELL传奇联赛', leagueDescription: '', leagueLogoUrl: null, leagueEdition: 'NATIONAL',
  currentSeason: { id: 'season-1', displayName: 'CELL S20', status: 'IN_PROGRESS', approvedEntryCount: 18 },
}

describe('read-only profile view model', () => {
  it('presents identity, memorable public number, and bound league teams', () => {
    expect(profileView(user, [team])).toMatchObject({
      displayName: 'Dust', publicUserNoDisplay: '000 123', hasTeams: true,
      teams: [{ teamName: '上海申花', leagueName: 'CELL传奇联赛', editionLabel: '国服', seasonName: 'CELL S20' }],
    })
  })

  it('is safe before identity data exists and has no editable-form state', () => {
    expect(profileView(null, [])).toEqual({
      displayName: '微信用户', avatarUrl: '', region: '未设置地区', publicUserNoDisplay: '暂无编号',
      publicUserNoCopy: '', hasTeams: false, teams: [],
    })
  })

  it('shows the user number before any league team is bound', () => {
    expect(profileView(user, [])).toMatchObject({
      publicUserNoDisplay: '000 123', publicUserNoCopy: '000123', hasTeams: false,
    })
  })
})
