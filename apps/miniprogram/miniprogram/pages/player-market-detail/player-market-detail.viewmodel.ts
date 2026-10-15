import type { PlayerMarketPlayerDetail } from '@efm/contracts'
import { marketPlayerCard } from '../player-market/player-market.viewmodel'

export function detailAction(detail: PlayerMarketPlayerDetail) {
  const card = marketPlayerCard(detail)
  if (detail.action === 'APPLY') return { ...card, label: '申请购买', warning: '最高报价不代表必然获批', minimumAmountMinor: 1 }
  if (detail.action === 'FORCE_SIGN') return { ...card, label: '发起强报', warning: '原球队无需同意', minimumAmountMinor: detail.officialValueMinor ?? 1 }
  return { ...card, label: card.actionLabel, warning: '', minimumAmountMinor: detail.officialValueMinor ?? 1 }
}

export function playerMarketDetailView(detail: PlayerMarketPlayerDetail) {
  return {
    ...detailAction(detail),
    showForcedTransferBadge: detail.forcedTransferBadge,
    owner: marketPlayerCard(detail).owner,
    publicApplicationCount: detail.publicApplications.length,
  }
}

export function marketErrorAction(code: string, teamId: string): { message: string; actionLabel: string; route: string | null } {
  const messages: Record<string, string> = {
    ROSTER_FULL: '阵容已满，请先下放一名球员',
    ROSTER_CAPACITY_REACHED: '阵容已满，请先下放一名球员',
    OWNERSHIP_CHANGED: '球员归属已变化，已为你刷新最新状态',
    REQUOTE_REQUIRED: '官方身价已变化，请按最新身价重新报价',
    TRANSFER_WINDOW_CLOSED: '转会窗口未开放',
    VERSION_CONFLICT: '申请状态已变化，请刷新后重试',
  }
  const release = code === 'ROSTER_FULL' || code === 'ROSTER_CAPACITY_REACHED'
  return {
    message: messages[code] ?? '操作未完成，请刷新后重试',
    actionLabel: release ? '去球队资产' : '刷新状态',
    route: release ? `/pages/team-assets/index?teamId=${encodeURIComponent(teamId)}&returnTo=player-market` : null,
  }
}
