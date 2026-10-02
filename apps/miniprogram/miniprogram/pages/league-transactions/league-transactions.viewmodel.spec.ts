import { expect, it } from 'vitest'
import { transactionView } from './league-transactions.viewmodel'

it('presents buyer, seller, transaction value, valuation snapshot, fee and note', () => {
  const view = transactionView({ id: 'tx-1', leagueId: 'league-1', seasonId: 'season-1', type: 'TRANSFER', playerId: 'player-1', playerName: '球员甲', sourceLeagueTeamId: 'a', sourceTeamName: '甲队', targetLeagueTeamId: 'b', targetTeamName: '乙队', amountMinor: 5000, valuationSnapshotMinor: 8000, transactionFeeMinor: 300, transactionFeeRuleVersionId: 'rule-1', reason: '协商转会', createdByAdminId: 'admin-1', createdAt: '2026-10-01T00:00:00.000Z' })
  expect(view).toMatchObject({ typeLabel: '转会', teamsCopy: '甲队 → 乙队', amountCopy: '5000', valuationCopy: '成交时身价 8000', feeCopy: '手续费 300', reason: '协商转会' })
})
