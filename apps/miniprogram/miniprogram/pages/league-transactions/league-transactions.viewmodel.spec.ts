import { expect, it } from 'vitest'
import { filterTransactions, transactionView } from './league-transactions.viewmodel'

it('presents buyer, seller, transaction value, valuation snapshot, fee and note', () => {
  const view = transactionView({ id: 'tx-1', leagueId: 'league-1', seasonId: 'season-1', type: 'TRANSFER', playerId: 'player-1', playerName: '球员甲', sourceLeagueTeamId: 'a', sourceTeamName: '甲队', targetLeagueTeamId: 'b', targetTeamName: '乙队', amountMinor: 5000, valuationSnapshotMinor: 8000, transactionFeeMinor: 300, transactionFeeRuleVersionId: 'rule-1', reason: '协商转会', createdByAdminId: 'admin-1', createdAt: '2026-10-01T00:00:00.000Z' })
  expect(view).toMatchObject({
    typeLabel: '转会', statusCopy: '已确认', teamsCopy: '甲队 → 乙队', buyerCopy: '乙队', sellerCopy: '甲队',
    amountCopy: '5,000', originalValueCopy: '8,000', newValueCopy: '5,000', feeValueCopy: '300',
    valuationCopy: '成交时身价 8,000', feeCopy: '手续费 300', noteCopy: '协商转会', dateCopy: '2026.10.01 00:00'
  })
})

it('filters formal transactions by market direction and operation category', () => {
  const item = (id: string, type: 'BUY'|'SELL'|'TRANSFER'|'EMERGENCY_CORRECTION') => transactionView({
    id, leagueId: 'league-1', seasonId: 'season-1', type, playerId: `player-${id}`, playerName: id,
    sourceLeagueTeamId: type === 'BUY' ? null : 'source', sourceTeamName: type === 'BUY' ? null : '甲队',
    targetLeagueTeamId: type === 'SELL' ? null : 'target', targetTeamName: type === 'SELL' ? null : '乙队',
    amountMinor: null, valuationSnapshotMinor: null, transactionFeeMinor: null,
    transactionFeeRuleVersionId: null, reason: '', createdByAdminId: 'admin-1', createdAt: '2026-10-01T00:00:00.000Z'
  })
  const items = [item('买入', 'BUY'), item('卖出', 'SELL'), item('转会', 'TRANSFER'), item('修正', 'EMERGENCY_CORRECTION')]

  expect(filterTransactions(items, 'BUY', 'ALL').map(({ playerName }) => playerName)).toEqual(['买入'])
  expect(filterTransactions(items, 'ALL', 'TRANSFER').map(({ playerName }) => playerName)).toEqual(['转会'])
  expect(filterTransactions(items, 'ALL', 'ADMIN').map(({ playerName }) => playerName)).toEqual(['修正'])
})
