import type { FinanceLedgerDirection, LeagueTeamRosterStatus, RosterEntry } from '@efm/contracts'

export function rosterState(entries: readonly Pick<RosterEntry, 'id'>[], status: LeagueTeamRosterStatus) {
  return { empty: entries.length === 0, overCap: status === 'OVER_CAP' }
}

export function ledgerAmount(direction: FinanceLedgerDirection, amountMinor: number): string {
  return `${direction === 'DEBIT' ? '-' : '+'}${amountMinor}`
}

export function readonlyActions(): readonly never[] {
  return []
}
