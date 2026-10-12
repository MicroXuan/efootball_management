import type { FinanceSettlementCategory, TeamFinanceSummary } from '@efm/contracts'

const labels: Record<string, string> = { PLAYER_PURCHASE: '购买球员', PLAYER_SALE: '出售球员', PLAYER_TRANSFER: '球员转会', CARD_UPGRADE: '卡片升级', TRANSACTION_FEE: '交易手续费', LUXURY_TAX: '奢侈税', OFFSEASON_FEE: '休赛期费用', UNFINISHED_MATCH_PENALTY: '未完赛处罚', AUCTION: '拍卖', ROOKIE_SELECTION: '新秀选择', INSTALLMENT_PAYMENT: '分期付款', MANUAL_ADJUSTMENT: '其他调整' }

const settlementDefinitions: ReadonlyArray<{ category: FinanceSettlementCategory; label: string }> = [
  { category: 'TRANSACTION_AMOUNT', label: '交易金额' },
  { category: 'LUXURY_TAX', label: '奢侈税金额' },
  { category: 'OFFSEASON_FEE', label: '休赛费用' },
  { category: 'UNFINISHED_MATCH_PENALTY', label: '未完赛处罚' },
  { category: 'PLAYER_AUCTION', label: '海摘竞拍金额' },
  { category: 'TEAM_AUCTION', label: '球队拍卖金额' },
  { category: 'ROOKIE_SELECTION', label: '新选秀金额' },
  { category: 'INSTALLMENT_PAYMENT', label: '分期付款' },
  { category: 'OTHER_ADJUSTMENT', label: '其他手动调整' }
]

function money(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function dateTime(value: string) {
  return `${value.slice(0, 10).replace(/-/g, '.')} ${value.slice(11, 16)}`
}

export function teamFinanceView(summary: TeamFinanceSummary) {
  const settlementAmounts = new Map((summary.settlementItems ?? []).map((item) => [item.category, item.amountMinor]))
  return {
    ...summary,
    notice: '实时账本 · 非最终结算',
    periodCopy: summary.seasonId === null ? '历史未归档账本' : '当前赛季账本',
    creditCopy: `+${money(summary.creditTotalMinor)}`,
    debitCopy: `-${money(summary.debitTotalMinor)}`,
    balanceCopy: `${summary.balanceMinor >= 0 ? '+' : '-'}${money(Math.abs(summary.balanceMinor))}`,
    balanceTone: summary.balanceMinor >= 0 ? 'positive' as const : 'negative' as const,
    settlementItems: settlementDefinitions.map(({ category, label }) => ({
      category,
      label,
      amountCopy: money(settlementAmounts.get(category) ?? 0)
    })),
    settlementTotalCopy: money(summary.settlementTotalMinor ?? 0),
    entries: summary.entries.map((entry) => ({
      ...entry,
      typeLabel: labels[entry.type] ?? '其他项目',
      directionLabel: entry.direction === 'CREDIT' ? '收入' : '支出',
      originCopy: entry.rosterTransactionId ? '交易自动记账' : '联赛管理调整',
      dateCopy: dateTime(entry.createdAt),
      noteCopy: entry.note.trim() || '无备注',
      amountCopy: `${entry.direction === 'CREDIT' ? '+' : '-'}${money(entry.amountMinor)}`
    }))
  }
}
