import type { TeamFinanceSummary } from '@efm/contracts'

const labels: Record<string, string> = { PLAYER_PURCHASE: '购买球员', PLAYER_SALE: '出售球员', PLAYER_TRANSFER: '球员转会', CARD_UPGRADE: '卡片升级', TRANSACTION_FEE: '交易手续费', LUXURY_TAX: '奢侈税', OFFSEASON_FEE: '休赛期费用', UNFINISHED_MATCH_PENALTY: '未完赛处罚', AUCTION: '拍卖', ROOKIE_SELECTION: '新秀选择', INSTALLMENT_PAYMENT: '分期付款', MANUAL_ADJUSTMENT: '其他调整' }
export function teamFinanceView(summary: TeamFinanceSummary) {
  return { ...summary, notice: '实时数据，非最终结算', balanceCopy: `${summary.balanceMinor >= 0 ? '+' : ''}${summary.balanceMinor}`, entries: summary.entries.map((entry) => ({ ...entry, typeLabel: labels[entry.type] ?? '其他项目', amountCopy: `${entry.direction === 'CREDIT' ? '+' : '-'}${entry.amountMinor}` })) }
}
