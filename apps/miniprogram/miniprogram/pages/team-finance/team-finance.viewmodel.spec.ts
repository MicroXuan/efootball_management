import { expect, it } from 'vitest'
import { teamFinanceView } from './team-finance.viewmodel'

it('presents live totals, non-final notice and Chinese finance categories', () => {
  const types = ['TRANSACTION_FEE', 'LUXURY_TAX', 'OFFSEASON_FEE', 'UNFINISHED_MATCH_PENALTY', 'AUCTION', 'ROOKIE_SELECTION', 'INSTALLMENT_PAYMENT', 'MANUAL_ADJUSTMENT'] as const
  const view = teamFinanceView({ leagueId: 'league-1', teamId: 'team-1', seasonId: 'season-1', creditTotalMinor: 2000, debitTotalMinor: 600, balanceMinor: 1400, uncategorizedEntryCount: 0, entries: types.map((type, index) => ({ id: `e-${index}`, leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1', rosterTransactionId: null, direction: index === 4 ? 'CREDIT' : 'DEBIT', type, amountMinor: 100, note: '明细', createdAt: '2026-10-01T00:00:00.000Z' })) })
  expect(view).toMatchObject({ notice: '实时账本 · 非最终结算', balanceCopy: '+1,400' })
  expect(view.entries.map(({ typeLabel }) => typeLabel)).toEqual(['交易手续费', '奢侈税', '休赛期费用', '未完赛处罚', '拍卖', '新秀选择', '分期付款', '其他调整'])
})

it('presents settlement context, entry time, origin and signed amount', () => {
  const view = teamFinanceView({
    leagueId: 'league-1', teamId: 'team-1', seasonId: 'season-1', creditTotalMinor: 12000,
    debitTotalMinor: 3500, balanceMinor: 8500, uncategorizedEntryCount: 0,
    entries: [
      {
        id: 'sale-1', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1',
        rosterTransactionId: 'transaction-1', direction: 'CREDIT', type: 'PLAYER_SALE', amountMinor: 12000,
        note: '出售球员收入', createdAt: '2026-10-01T12:30:00.000Z'
      },
      {
        id: 'tax-1', leagueId: 'league-1', leagueTeamId: 'team-1', seasonId: 'season-1',
        rosterTransactionId: null, direction: 'DEBIT', type: 'LUXURY_TAX', amountMinor: 3500,
        note: '', createdAt: '2026-10-02T08:05:00.000Z'
      }
    ]
  })

  expect(view).toMatchObject({
    notice: '实时账本 · 非最终结算', periodCopy: '当前赛季账本', balanceCopy: '+8,500',
    creditCopy: '+12,000', debitCopy: '-3,500', balanceTone: 'positive'
  })
  expect(view.entries).toMatchObject([
    { typeLabel: '出售球员', directionLabel: '收入', originCopy: '交易自动记账', dateCopy: '2026.10.01 12:30', amountCopy: '+12,000' },
    { typeLabel: '奢侈税', directionLabel: '支出', originCopy: '联赛管理调整', dateCopy: '2026.10.02 08:05', noteCopy: '无备注', amountCopy: '-3,500' }
  ])
})

it('marks a historical unassigned ledger and a negative balance clearly', () => {
  const view = teamFinanceView({
    leagueId: 'league-1', teamId: 'team-1', seasonId: null, creditTotalMinor: 0,
    debitTotalMinor: 600, balanceMinor: -600, uncategorizedEntryCount: 1, entries: []
  })

  expect(view).toMatchObject({ periodCopy: '历史未归档账本', balanceCopy: '-600', balanceTone: 'negative' })
})
