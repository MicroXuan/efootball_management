import type { DivisionStandingsResponse } from '@efm/contracts'

export type StandingsRowResponse = DivisionStandingsResponse['groups'][number]['standings']['rows'][number]

export type StandingsTab = {
  id: string
  code: string
  label: string
  countLabel: string
  isMine: boolean
}

export type StandingRowView = StandingsRowResponse & {
  rankLabel: string
  medalLabel: string
  rankAccent: boolean
  isMine: boolean
  tieLabel: string
  teamIdentityLabel: string
  teamLogoSrc: string
  logoFallback: string
}

export function stageShortLabel(code: string): string {
  if (code === 'SUPER') return '超级组'
  if (code.startsWith('CHAMPION_')) return `冠军 ${code.slice('CHAMPION_'.length)} 组`
  return code
}

export function standingsTabs(response: DivisionStandingsResponse): StandingsTab[] {
  return response.groups.map(({ stage }) => ({
    id: stage.id,
    code: stage.stageCode,
    label: stageShortLabel(stage.stageCode),
    countLabel: `${stage.participantCount} 队`,
    isMine: stage.id === response.myStageId,
  }))
}

export function initialStageIndex(response: DivisionStandingsResponse): number {
  const mine = response.groups.findIndex(({ stage }) => stage.id === response.myStageId)
  return mine >= 0 ? mine : 0
}

export function seasonStandingsTitle(displayName: string): string {
  const name = displayName.trim()
  return name.endsWith('积分榜') ? name : `${name}积分榜`
}

export function standingRows(rows: readonly StandingsRowResponse[], myTeamName: string): StandingRowView[] {
  return rows.map((row, index) => ({
    ...row,
    rankLabel: String(index + 1),
    medalLabel: ['🥇', '🥈', '🥉'][index] ?? '',
    rankAccent: index === 3,
    isMine: Boolean(myTeamName) && row.displayName === myTeamName,
    tieLabel: row.tiePending ? '同分待定' : '',
    teamIdentityLabel: row.teamNumber === null ? row.teamName : `${row.teamNumber}-${row.teamName}`,
    teamLogoSrc: row.teamLogoUrl ?? '',
    logoFallback: row.teamShortName.slice(0, 2),
  }))
}

export function standingsErrorMessage(code: string): string {
  if (code === 'DIVISION_STANDINGS_FORBIDDEN') return '报名审核通过后，才可查看本赛季分组积分榜'
  if (code === 'DIVISION_COMPETITION_NOT_FOUND') return '管理员尚未确认本赛季正式分组'
  if (code === 'NETWORK_ERROR') return '网络连接失败，请检查网络后重试'
  return '积分榜暂时不可用，请稍后重试'
}
