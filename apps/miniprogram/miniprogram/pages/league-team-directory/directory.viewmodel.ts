import type { PublicLeagueTeamDirectory } from '@efm/contracts'

export function directoryRows(directory: PublicLeagueTeamDirectory, keyword: string) {
  const search = keyword.trim().toLocaleLowerCase('zh-CN')
  return directory.items
    .filter((team) => !search || [team.teamName, team.ownerAlias, team.teamNumber?.toString() ?? '']
      .some((value) => value.toLocaleLowerCase('zh-CN').includes(search)))
    .map((team) => ({
      ...team,
      identity: `${team.teamNumber === null ? '待编号' : `${String(team.teamNumber).padStart(2, '0')}号`} · ${team.teamName}`,
      crestFallback: Array.from(team.teamName)[0] ?? '队'
    }))
}
