import { expect, it } from 'vitest'
import { teamFinanceView } from './team-finance.viewmodel'

it('presents live totals, non-final notice and Chinese finance categories', () => {
  const types = ['TRANSACTION_FEE', 'LUXURY_TAX', 'OFFSEASON_FEE', 'UNFINISHED_MATCH_PENALTY', 'AUCTION', 'ROOKIE_SELECTION', 'INSTALLMENT_PAYMENT', 'MANUAL_ADJUSTMENT'] as const
  const view = teamFinanceView({ leagueId: 'league-1', teamId: 'team-1', seasonId: 'season-1', creditTotalMinor: 2000, debitTotalMinor: 600, balanceMinor: 1400, uncategorizedEntryCount: 0, entries: types.map((type, index) => ({ id: `e-${index}`, leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1', rosterTransactionId: null, direction: index === 4 ? 'CREDIT' : 'DEBIT', type, amountMinor: 100, note: '明细', createdAt: '2026-10-01T00:00:00.000Z' })) })
  expect(view).toMatchObject({ notice: '实时数据，非最终结算', balanceCopy: '+1400' })
  expect(view.entries.map(({ typeLabel }) => typeLabel)).toEqual(['交易手续费', '奢侈税', '休赛期费用', '未完赛处罚', '拍卖', '新秀选择', '分期付款', '其他调整'])
})
