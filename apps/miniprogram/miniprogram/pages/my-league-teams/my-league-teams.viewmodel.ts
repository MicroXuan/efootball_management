import type { LeagueTeamSummary } from '@efm/contracts'

export type LeagueTeamListItem = LeagueTeamSummary & {
  rosterCopy: string
  salaryCopy: string
  statusCopy: string
}

export function presentLeagueTeams(teams: readonly LeagueTeamSummary[]): LeagueTeamListItem[] {
  return teams.map((team) => ({
    ...team,
    rosterCopy: `${team.activePlayerCount}/25`,
    salaryCopy: `${team.salaryTotalMinor}/${team.salaryCapMinor}`,
    statusCopy: team.rosterStatus === 'OVER_CAP' ? '工资超帽' : '阵容合规',
  }))
}

export function formatPublicUserNo(value: string): { display: string; copyValue: string } {
  const copyValue = value.padStart(6, '0').slice(-6)
  return { display: `${copyValue.slice(0, 3)} ${copyValue.slice(3)}`, copyValue }
}
