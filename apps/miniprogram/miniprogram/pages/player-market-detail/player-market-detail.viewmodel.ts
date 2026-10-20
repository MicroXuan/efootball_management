import type { PlayerMarketPlayerDetail, SubmitPlayerApplicationRequest } from '@efm/contracts'
import { marketPlayerCard } from '../player-market/player-market.viewmodel'

export function detailAction(detail: PlayerMarketPlayerDetail) {
  const card = marketPlayerCard(detail)
  if (detail.action === 'APPLY') return { ...card, label: '申请购买', warning: '最高报价不代表必然获批', minimumAmountMinor: 1 }
  if (detail.action === 'FORCE_SIGN') return { ...card, label: '发起强报', warning: '原球队无需同意', minimumAmountMinor: detail.officialValueMinor ?? 1 }
  return { ...card, label: card.actionLabel, warning: '', minimumAmountMinor: detail.officialValueMinor ?? 1 }
}

export function playerMarketDetailView(detail: PlayerMarketPlayerDetail) {
  const impact = detail.salaryImpact
  const tier = detail.salary.kind === 'ACTUAL' ? detail.salary.currentTier : null
  return {
    ...detailAction(detail),
    currentTierLabel: tier && tier.salaryMinor !== detail.salary.salaryMinor ? `现行档位 ${tier.salaryMinor}` : '',
    salaryImpact: {
      currentLabel: String(impact.currentSalaryMinor),
      capLabel: impact.salaryCapMinor === null ? '未设置' : String(impact.salaryCapMinor),
      projectedLabel: impact.projectedSalaryMinor === null ? '暂无法预览' : String(impact.projectedSalaryMinor),
      overCapLabel: impact.overCapMinor && impact.overCapMinor > 0 ? `预计超出 ${impact.overCapMinor}` : '',
    },
    showForcedTransferBadge: detail.forcedTransferBadge,
    owner: marketPlayerCard(detail).owner,
    publicApplicationCount: detail.publicApplications.length,
  }
}

export function buildPlayerApplicationInput(detail: PlayerMarketPlayerDetail, amountMinor: number, seasonId: string): SubmitPlayerApplicationRequest | null {
  if (!detail.card || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null
  const base = {
    seasonId,
    footballPlayerId: detail.playerId,
    playerCardId: detail.card.playerCardId,
    amountMinor,
  }
  if (detail.action === 'FORCE_SIGN') {
    if (!detail.activeForcedOfferWindowId || !detail.currentOwner || !detail.ownershipId || !detail.ownershipVersion) return null
    return {
      ...base,
      type: 'FORCED_TRANSFER',
      window: { kind: 'FORCED_OFFER', id: detail.activeForcedOfferWindowId },
      sourceLeagueTeamId: detail.currentOwner.teamId,
      ownershipId: detail.ownershipId,
      ownershipVersionSnapshot: detail.ownershipVersion,
    }
  }
  if (detail.action !== 'APPLY' || !detail.activeTransferWindowId) return null
  return { ...base, type: 'NORMAL_PURCHASE', window: { kind: 'TRANSFER', id: detail.activeTransferWindowId } }
}

export function canEditPlayerApplication(
  detail: PlayerMarketPlayerDetail,
  application: Pick<NonNullable<PlayerMarketPlayerDetail['myApplication']>, 'type' | 'status' | 'transferWindowId' | 'forcedOfferWindowId'>,
): boolean {
  if (application.status !== 'PENDING' && application.status !== 'REQUOTE_REQUIRED') return false
  return application.type === 'FORCED_TRANSFER'
    ? Boolean(application.forcedOfferWindowId && application.forcedOfferWindowId === detail.activeForcedOfferWindowId)
    : Boolean(application.transferWindowId && application.transferWindowId === detail.activeTransferWindowId)
}

export function rejectedApplicationAction(detail: PlayerMarketPlayerDetail) {
  if (detail.myApplication?.status !== 'REJECTED' && detail.myApplication?.status !== 'WITHDRAWN') return null
  const enabled = detail.action === 'APPLY' || detail.action === 'FORCE_SIGN'
  const actionLabel = detail.action === 'APPLY' || detail.action === 'DISABLED' && detail.myApplication.type === 'NORMAL_PURCHASE'
    ? '重新申请购买' : '重新发起强报'
  const hints: Record<string, string> = {
    FORCED_OFFER_WINDOW_CLOSED: '强报期未开放或已结束，请等待下一次强报期。',
    TRANSFER_WINDOW_CLOSED: '转会窗口未开放，请等待下一次可购买窗口。',
    ROSTER_CAPACITY_REACHED: '球队阵容已满，请先下放球员后刷新。',
    ROSTER_NON_COMPLIANT: '球队阵容或工资帽暂不合规，处理后刷新。',
    OFFICIAL_VALUE_REQUIRED: '官方身价尚未设置，暂不能重新强报。',
  }
  return {
    enabled,
    actionLabel,
    hint: enabled
      ? detail.myApplication.status === 'WITHDRAWN' ? '原申请已撤回；你可以提交一笔新申请。' : '原申请已结束；你可以提交一笔新申请。'
      : hints[detail.disabledReason ?? ''] ?? '当前球员状态不允许重新申请，请刷新后查看。',
  }
}

export function marketErrorAction(code: string, teamId: string): { message: string; actionLabel: string; route: string | null } {
  const messages: Record<string, string> = {
    ROSTER_FULL: '阵容已满，请先下放一名球员',
    ROSTER_CAPACITY_REACHED: '阵容已满，请先下放一名球员',
    OWNERSHIP_CHANGED: '球员归属已变化，已为你刷新最新状态',
    REQUOTE_REQUIRED: '官方身价已变化，请按最新身价重新报价',
    TRANSFER_WINDOW_CLOSED: '转会窗口未开放',
    FORCED_OFFER_WINDOW_CLOSED: '强报期未开放或已结束，已提交的申请仍可等待审核或撤回',
    OFFICIAL_VALUE_REQUIRED: '该球员尚未设置官方身价，暂不能发起强报',
    FORCED_AMOUNT_BELOW_OFFICIAL_VALUE: '强报金额不得低于当前官方身价，请刷新后重新报价',
    CLIENT_UPGRADE_REQUIRED: '请更新小程序后再发起强报',
    VERSION_CONFLICT: '申请状态已变化，请刷新后重试',
  }
  const release = code === 'ROSTER_FULL' || code === 'ROSTER_CAPACITY_REACHED'
  return {
    message: messages[code] ?? '操作未完成，请刷新后重试',
    actionLabel: release ? '去球队资产' : '刷新状态',
    route: release ? `/pages/team-assets/index?teamId=${encodeURIComponent(teamId)}&returnTo=player-market` : null,
  }
}
