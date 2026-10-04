import type { LeagueTransactionListItem } from '@efm/contracts'

const typeLabels: Record<string, string> = { BUY: '购买', SELL: '出售', RELEASE: '解约', TRANSFER: '转会', CARD_UPGRADE: '卡片升级', SALARY_RECALCULATION: '工资重算', EMERGENCY_CORRECTION: '紧急修正' }

export type TransactionDirectionFilter = 'ALL'|'BUY'|'SELL'
export type TransactionTypeFilter = 'ALL'|'TRANSFER'|'ADMIN'

function money(value: number | null) {
  return value === null ? '未记录' : String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function dateTime(value: string) {
  return `${value.slice(0, 10).replace(/-/g, '.')} ${value.slice(11, 16)}`
}

export function transactionView(item: LeagueTransactionListItem) {
  const directionGroup = item.type === 'BUY' ? 'BUY' as const
    : item.type === 'SELL' || item.type === 'RELEASE' ? 'SELL' as const : 'OTHER' as const
  const categoryGroup = item.type === 'TRANSFER' ? 'TRANSFER' as const
    : item.type === 'EMERGENCY_CORRECTION' || item.type === 'SALARY_RECALCULATION' ? 'ADMIN' as const : 'OTHER' as const
  const amountCopy = money(item.amountMinor)
  const valuationCopy = money(item.valuationSnapshotMinor)
  const feeCopy = money(item.transactionFeeMinor)
  return {
    ...item,
    typeLabel: typeLabels[item.type] ?? '其他交易',
    statusCopy: '已确认',
    teamsCopy: `${item.sourceTeamName ?? '外部'} → ${item.targetTeamName ?? '外部'}`,
    buyerCopy: item.targetTeamName ?? '无买方',
    sellerCopy: item.sourceTeamName ?? '无卖方',
    amountCopy,
    originalValueCopy: valuationCopy,
    newValueCopy: amountCopy,
    feeValueCopy: feeCopy,
    valuationCopy: item.valuationSnapshotMinor === null ? '成交时身价缺失' : `成交时身价 ${valuationCopy}`,
    feeCopy: item.transactionFeeMinor === null ? '无手续费' : `手续费 ${feeCopy}`,
    noteCopy: item.reason.trim() || '无备注',
    dateCopy: dateTime(item.createdAt),
    directionGroup,
    categoryGroup
  }
}

export type TransactionView = ReturnType<typeof transactionView>

export function filterTransactions(
  items: TransactionView[],
  direction: TransactionDirectionFilter,
  type: TransactionTypeFilter
) {
  return items.filter((item) =>
    (direction === 'ALL' || item.directionGroup === direction)
    && (type === 'ALL' || item.categoryGroup === type))
}
