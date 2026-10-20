import type {
  PlayerAcquisitionApplication,
  PlayerApplicationEvent,
  PlayerMarketAnnouncement,
  PlayerMarketPlayerSummary,
  PlayerMarketTeamSummary,
} from '@efm/contracts'

const amount = (value: number | null): string => value === null ? '待定' : String(value)
const date = (value: string): string => value.slice(5, 16).replace('T', ' ')

export function mergeMarketPlayerPages<T extends { playerId: string }>(
  current: T[],
  incoming: T[],
  mode: 'replace' | 'append',
): T[] {
  if (mode === 'replace') return incoming
  const seen = new Set<string>()
  return [...current, ...incoming].filter(({ playerId }) => !seen.has(playerId) && Boolean(seen.add(playerId)))
}

export function shouldShowMarketBackToTop(scrollTop: number): boolean {
  return scrollTop >= 700
}

export function teamIdentity(team: PlayerMarketTeamSummary | null) {
  if (!team) return null
  return {
    numberLabel: team.teamNumber === null ? '—' : String(team.teamNumber),
    logoUrl: team.logoUrl,
    fallback: team.name.slice(0, 1),
    name: team.name,
    ownerAlias: team.ownerAlias,
  }
}

export function marketPlayerCard(item: PlayerMarketPlayerSummary) {
  const disabledLabels: Record<string, string> = {
    ROSTER_FULL: '先下放球员',
    ROSTER_CAPACITY_REACHED: '先下放球员',
    TRANSFER_WINDOW_CLOSED: '窗口未开放',
    FORCED_OFFER_WINDOW_CLOSED: '强报期未开放',
    ROSTER_NON_COMPLIANT: '阵容待补足',
    REQUOTE_REQUIRED: '需重新报价',
    OWNERSHIP_CHANGED: '归属已变化',
    RELEASED_BY_TEAM_IN_WINDOW: '本窗口不可回购',
  }
  const labels = {
    APPLY: '申请购买', FORCE_SIGN: '发起强报', OWNED_BY_ME: '本队球员', DISABLED: disabledLabels[item.disabledReason ?? ''] ?? '暂不可申请',
  } as const
  return {
    ...item,
    owner: teamIdentity(item.currentOwner),
    portraitUrl: item.card?.imageUrl ?? '',
    portraitFallback: item.playerName.trim().slice(0, 1) || '球',
    position: item.card?.position ?? '—',
    overallLabel: item.card?.maxOverall === null || item.card?.maxOverall === undefined ? '—' : String(item.card.maxOverall),
    officialValueLabel: amount(item.officialValueMinor),
    actionLabel: labels[item.action],
    actionEnabled: item.action === 'APPLY' || item.action === 'FORCE_SIGN',
    releaseRequired: item.disabledReason === 'ROSTER_FULL' || item.disabledReason === 'ROSTER_CAPACITY_REACHED',
  }
}

const eventLabels: Record<PlayerApplicationEvent['type'], string> = {
  SUBMITTED: '首次提交', AMOUNT_CHANGED: '修改报价', WITHDRAWN: '撤回申请', APPROVED: '管理员通过',
  REJECTED: '管理员驳回', NOT_SELECTED: '未被选中', EXPIRED: '申请过期', REQUOTE_REQUIRED: '需重新报价',
  OWNERSHIP_CHANGED: '归属已变化', INELIGIBLE: '资格失效',
}

export function applicationCard(item: PlayerAcquisitionApplication) {
  return {
    ...item,
    applicant: teamIdentity(item.applicantTeam),
    source: teamIdentity(item.sourceTeam),
    amountLabel: amount(item.amountMinor),
    typeLabel: item.type === 'FORCED_TRANSFER' ? '强报' : '购买申请',
    statusLabel: ({ PENDING: '审核中', APPROVED: '已通过', NOT_SELECTED: '未选中', REJECTED: '已驳回', WITHDRAWN: '已撤回', EXPIRED: '已过期', INELIGIBLE: '资格失效', REQUOTE_REQUIRED: '需重新报价', OWNERSHIP_CHANGED: '归属变化' } as Record<string, string>)[item.status] ?? item.status,
    canEdit: item.status === 'PENDING' || item.status === 'REQUOTE_REQUIRED',
    canWithdraw: item.status === 'PENDING' || item.status === 'REQUOTE_REQUIRED',
    timeline: item.events.map((event) => ({
      id: event.id,
      label: eventLabels[event.type],
      time: date(event.createdAt),
      detail: [event.toAmountMinor === null ? '' : `金额 ${event.toAmountMinor}`, event.reason ?? ''].filter(Boolean).join(' · '),
    })),
  }
}

export function announcementCard(item: PlayerMarketAnnouncement) {
  const labels: Record<PlayerMarketAnnouncement['kind'], string> = {
    NORMAL_PURCHASE: '购买成交', FORCED_TRANSFER: '强报成交', RELEASE: '球员下放', APPLICATION_CLOSED: '申请结案',
  }
  return { ...item, kindLabel: labels[item.kind], amountLabel: amount(item.amountMinor), timeLabel: date(item.createdAt) }
}
