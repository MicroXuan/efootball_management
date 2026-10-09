import type { FinanceLedgerDirection, LeagueTeamRosterStatus, MyLeagueTeamOverview, RosterEntry } from '@efm/contracts'

export function rosterState(entries: readonly Pick<RosterEntry, 'id'>[], status: LeagueTeamRosterStatus) {
  return { empty: entries.length === 0, overCap: status === 'OVER_CAP' }
}

export function ledgerAmount(direction: FinanceLedgerDirection, amountMinor: number): string {
  return `${direction === 'DEBIT' ? '-' : '+'}${amountMinor}`
}

export function readonlyActions(): readonly never[] {
  return []
}

type OverviewRosterEntry = MyLeagueTeamOverview['roster'][number]

function positionTone(position: OverviewRosterEntry['position']): 'keeper'|'defender'|'midfielder'|'forward' {
  if (position === 'GK') return 'keeper'
  if (['CB', 'LB', 'RB'].includes(position)) return 'defender'
  if (['DMF', 'CMF', 'LMF', 'RMF', 'AMF'].includes(position)) return 'midfielder'
  return 'forward'
}

export function rosterPlayerView(entry: Pick<OverviewRosterEntry, 'id'|'playerName'|'position'|'heightCm'|'salaryMinor'>) {
  return {
    id: entry.id,
    playerName: entry.playerName,
    position: entry.position,
    positionTone: positionTone(entry.position),
    heightCopy: entry.heightCm ? `${entry.heightCm}cm` : '身高未知',
    positionCopy: entry.position,
    salaryCopy: String(entry.salaryMinor)
  }
}

export function teamDetailActions(teamId: string, leagueId: string) {
  return [
    { key: 'assets', marker: '资', label: '球队资产', description: '阵容与总价值', url: `/pages/team-assets/index?teamId=${teamId}` },
    { key: 'valuations', marker: '价', label: '身价管理', description: '调整球员身价', url: `/pages/valuation-manage/index?teamId=${teamId}` },
    { key: 'transactions', marker: '交', label: '交易记录', description: '查看转会明细', url: `/pages/league-transactions/index?leagueId=${leagueId}` },
    { key: 'finance', marker: '财', label: '财务流水', description: '工资与收支', url: `/pages/team-finance/index?teamId=${teamId}` }
  ] as const
}
