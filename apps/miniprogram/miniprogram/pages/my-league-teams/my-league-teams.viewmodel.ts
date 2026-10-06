import type { LeagueTeamSummary } from '@efm/contracts'

export type LeagueTeamListItem = LeagueTeamSummary & {
  rosterCopy: string
  salaryCopy: string
  statusCopy: string
  identityCopy: string
  ownerAliasCopy: string
  logoFallback: string
}

export function presentLeagueTeams(teams: readonly LeagueTeamSummary[]): LeagueTeamListItem[] {
  return teams.map((team) => ({
    ...team,
    rosterCopy: `${team.activePlayerCount}/25`,
    salaryCopy: `${team.salaryTotalMinor}/${team.salaryCapMinor}`,
    statusCopy: team.rosterStatus === 'OVER_CAP' ? '工资超帽' : '阵容合规',
    identityCopy: `${team.teamNumber === null ? '—' : team.teamNumber}-${team.name}`,
    ownerAliasCopy: `（${team.ownerAlias}）`,
    logoFallback: (team.shortName.trim() || team.name.trim() || '球队').slice(0, 2),
  }))
}

export function formatPublicUserNo(value: string): { display: string; copyValue: string } {
  const copyValue = value.padStart(6, '0').slice(-6)
  return { display: `${copyValue.slice(0, 3)} ${copyValue.slice(3)}`, copyValue }
}
