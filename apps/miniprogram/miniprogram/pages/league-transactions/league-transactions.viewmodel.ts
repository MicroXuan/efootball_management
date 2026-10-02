import type { LeagueTransactionListItem } from '@efm/contracts'

const typeLabels: Record<string, string> = { BUY: '购买', SELL: '出售', RELEASE: '解约', TRANSFER: '转会', CARD_UPGRADE: '卡片升级', SALARY_RECALCULATION: '工资重算', EMERGENCY_CORRECTION: '紧急修正' }
export function transactionView(item: LeagueTransactionListItem) {
  return { ...item, typeLabel: typeLabels[item.type] ?? '其他交易', teamsCopy: `${item.sourceTeamName ?? '外部'} → ${item.targetTeamName ?? '外部'}`, amountCopy: item.amountMinor === null ? '未记录成交额' : String(item.amountMinor), valuationCopy: item.valuationSnapshotMinor === null ? '成交时身价缺失' : `成交时身价 ${item.valuationSnapshotMinor}`, feeCopy: item.transactionFeeMinor === null ? '无手续费' : `手续费 ${item.transactionFeeMinor}` }
}
