import type {
  PlayerAcquisitionApplication,
  PlayerApplicationEvent,
  PlayerMarketAnnouncement,
  PlayerMarketPlayerSummary,
  PlayerMarketTeamSummary,
} from '@efm/contracts'

const amount = (value: number | null): string => value === null ? '待定' : String(value)
const date = (value: string): string => value.slice(5, 16).replace('T', ' ')
const countries: Record<string, string> = {
  Argentina: '阿根廷', Australia: '澳大利亚', Belgium: '比利时', Brazil: '巴西', Canada: '加拿大',
  China: '中国', Croatia: '克罗地亚', Denmark: '丹麦', England: '英格兰', France: '法国',
  Germany: '德国', Ghana: '加纳', Italy: '意大利', Japan: '日本', 'Korea Republic': '韩国',
  Mexico: '墨西哥', Morocco: '摩洛哥', Netherlands: '荷兰', Nigeria: '尼日利亚',
  Norway: '挪威', Portugal: '葡萄牙', Senegal: '塞内加尔', Spain: '西班牙',
  Switzerland: '瑞士', Uruguay: '乌拉圭', 'United States': '美国',
}

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
  const unavailableLabels = {
    AUTO_BUILD_MISSING: '自动加点结果未保存',
    SALARY_RULE_NOT_CONFIGURED: '联赛工资规则未配置',
    SALARY_TIER_NOT_CONFIGURED: '未匹配工资档位',
  }
  const foot = item.preferredFoot?.trim().toUpperCase()
  const footLabels: Record<string, string> = { LEFT: '左脚', L: '左脚', RIGHT: '右脚', R: '右脚', BOTH: '双足' }
  const profileFacts = [
    item.age ? { key: 'age', label: '年龄', value: `${item.age}岁` } : null,
    item.heightCm ? { key: 'height', label: '身高', value: `${item.heightCm}cm` } : null,
    item.weightKg ? { key: 'weight', label: '体重', value: `${item.weightKg}kg` } : null,
    foot ? { key: 'foot', label: '惯用脚', value: footLabels[foot] ?? item.preferredFoot!.trim() } : null,
  ].filter((fact): fact is { key: string; label: string; value: string } => fact !== null)
  const disabledLabels: Record<string, string> = {
    ROSTER_FULL: '先下放球员',
    ROSTER_CAPACITY_REACHED: '先下放球员',
    TRANSFER_WINDOW_CLOSED: '窗口未开放',
    FORCED_OFFER_WINDOW_CLOSED: '强报期未开放',
    OFFICIAL_VALUE_REQUIRED: '待设置身价',
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
    nationalityLabel: item.nationalityZh || (item.nationality ? countries[item.nationality] ?? item.nationality : '国籍未知'),
    clubLabel: item.clubZh || item.club || '俱乐部未知',
    salaryHeading: item.salary.kind === 'ACTUAL' ? '实际工资' : '预计签入工资',
    salaryLabel: item.salary.salaryMinor === null ? '暂无可靠报价' : amount(item.salary.salaryMinor),
    salaryUnavailableLabel: item.salary.unavailableReason
      ? unavailableLabels[item.salary.unavailableReason] : '',
    profileFacts,
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
    NORMAL_PURCHASE: '转会新闻', FORCED_TRANSFER: '强报新闻', TRANSFER: '转会新闻', RELEASE: '球员下放', APPLICATION_CLOSED: '申请结案',
  }
  const sourceEmptyLabel = item.kind === 'NORMAL_PURCHASE' ? '自由球员' : '原球队未记录'
  const targetEmptyLabel = item.kind === 'RELEASE' ? '自由球员' : '新球队未记录'
  const teamName = (team: PlayerMarketTeamSummary | null, emptyLabel: string) => team ? `${team.name}（${team.ownerAlias}）` : emptyLabel
  const newsTeam = (team: PlayerMarketTeamSummary | null, emptyLabel: string) => team ? {
    ...teamIdentity(team)!,
    numberCopy: team.teamNumber === null ? '' : `${team.teamNumber} 号`,
    hasTeam: true,
  } : { numberLabel: '', numberCopy: '', logoUrl: null, fallback: emptyLabel === '自由球员' ? '自' : '?', name: emptyLabel, ownerAlias: '', hasTeam: false }
  return { ...item, kindLabel: labels[item.kind], amountLabel: item.amountMinor === null ? '未记录' : amount(item.amountMinor),
    valuationLabel: item.valuationSnapshotMinor == null ? '未记录' : amount(item.valuationSnapshotMinor),
    sourceLabel: teamName(item.sourceTeam, sourceEmptyLabel), targetLabel: teamName(item.targetTeam, targetEmptyLabel),
    source: newsTeam(item.sourceTeam, sourceEmptyLabel),
    target: newsTeam(item.targetTeam, targetEmptyLabel),
    timeLabel: date(item.createdAt) }
}
