import type { LeagueTeamSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { formatPublicUserNo, presentLeagueTeams } from './my-league-teams.viewmodel'

const team = (id: string, leagueId: string, name: string): LeagueTeamSummary => ({
  id, leagueId, ownerUserId: '33333333-3333-4333-8333-333333333333', ownerPublicUserNo: '000123',
  teamNumber: 7, name, shortName: name, logoUrl: null, status: 'ACTIVE', rosterStatus: 'COMPLIANT',
  activePlayerCount: 2, salaryTotalMinor: 300, salaryCapMinor: 2_000, version: 1,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})

describe('my league teams viewmodel', () => {
  it('keeps independent teams from multiple leagues', () => {
    expect(presentLeagueTeams([team('a', 'league-a', 'A队'), team('b', 'league-b', 'B队')]).map(({ name }) => name)).toEqual(['A队', 'B队'])
  })

  it('preserves the copyable six-digit public user number', () => {
    expect(formatPublicUserNo('000123')).toEqual({ display: '000 123', copyValue: '000123' })
  })
})
