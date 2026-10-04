import type { LeagueSeasonStatus, LeagueSeasonSummary, LeagueWorkspaceResponse, SeasonEntryResponse } from '@efm/contracts'

export type SeasonRailStep = {
  key: 'registration' | 'confirmation' | 'schedule' | 'settlement'
  label: '报名' | '确认' | '赛程' | '结算'
  state: 'complete' | 'current' | 'upcoming' | 'cancelled'
}

const railBase: ReadonlyArray<Pick<SeasonRailStep, 'key' | 'label'>> = [
  { key: 'registration', label: '报名' },
  { key: 'confirmation', label: '确认' },
  { key: 'schedule', label: '赛程' },
  { key: 'settlement', label: '结算' },
]

export function seasonRailSteps(status: LeagueSeasonStatus): SeasonRailStep[] {
  if (status === 'CANCELLED') {
    return railBase.map((step) => ({ ...step, state: 'cancelled' }))
  }
  if (status === 'COMPLETED') {
    return railBase.map((step) => ({ ...step, state: 'complete' }))
  }

  const currentIndex = status === 'ALLOCATION_REVIEW'
    ? 1
    : status === 'READY' || status === 'IN_PROGRESS'
      ? 2
      : 0
  return railBase.map((step, index) => ({
    ...step,
    state: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming',
  }))
}

export function selectSeason(
  seasons: readonly LeagueSeasonSummary[],
  requestedId?: string,
): LeagueSeasonSummary | null {
  return seasons.find((season) => season.id === requestedId) ?? seasons[0] ?? null
}

export function seasonStructureCopy(season: LeagueSeasonSummary): string {
  return season.isFirstSeason
    ? '首赛季仅设冠军组，超级组将由本赛季排名产生'
    : '本赛季包含超级组与冠军组，分组由管理员确认'
}

export function entryStatusCopy(
  isAuthenticated: boolean,
  hasLeagueTeam: boolean,
  entry: SeasonEntryResponse | null,
): string {
  if (!isAuthenticated) return '登录后查看管理员分配的联赛球队'
  if (!hasLeagueTeam) return '请联系联赛管理员分配球队'
  if (!entry) return '当前赛季尚未入组'
  const labels: Record<SeasonEntryResponse['status'], string> = {
    INVITED: '等待确认参赛资格',
    PENDING: '等待管理员确认',
    APPROVED: '已报名当前赛季',
    REJECTED: '本赛季未通过审核',
    WITHDRAWN: '本赛季已退出',
  }
  return labels[entry.status]
}

export function standingsAccess(entry: SeasonEntryResponse | null): {
  enabled: boolean
  label: string
  hint: string
} {
  if (entry?.status === 'APPROVED') {
    return { enabled: true, label: '查看分组积分榜', hint: '查看各组实时排名与比赛数据' }
  }
  return { enabled: false, label: '报名后开放', hint: '仅当前赛季正式参赛球队可查看' }
}

export function workspaceSummary(workspace: LeagueWorkspaceResponse) {
  const rank = workspace.currentRank
    ? `${workspace.currentRank.rank}${workspace.currentRank.tiePending ? '*' : ''}`
    : '—'
  const nextMatch = workspace.nextMatch
    ? `第 ${workspace.nextMatch.roundNumber} 轮 · 对阵 ${workspace.nextMatch.opponentName}`
    : '暂无待进行比赛'
  return {
    teamName: workspace.team.name,
    teamShortName: workspace.team.shortName,
    divisionName: workspace.division?.displayName ?? '等待正式分组',
    rank,
    rankMeta: workspace.currentRank ? `${workspace.currentRank.played} 场 · ${workspace.currentRank.points} 分` : '排名尚未产生',
    nextMatch,
    nextMatchTime: workspace.nextMatch?.plannedAt?.slice(0, 16).replace('T', ' ') ?? '时间待定',
  }
}

export type WorkspaceModuleKey =
  | 'standings'
  | 'assets'
  | 'transactions'
  | 'finance'
  | 'valuations'
  | 'cups'
  | 'favorites'

export type WorkspaceModule = {
  key: WorkspaceModuleKey
  marker: string
  label: string
  description: string
  stateLabel: string
  enabled: boolean
  tone: 'active' | 'locked' | 'personal'
  wide?: boolean
}

export function workspaceModules(workspace: LeagueWorkspaceResponse): WorkspaceModule[] {
  const standard = (input: Omit<WorkspaceModule, 'stateLabel' | 'tone'>): WorkspaceModule => ({
    ...input,
    stateLabel: input.enabled ? '可查看' : '暂不可用',
    tone: input.enabled ? 'active' : 'locked',
  })
  return [
    standard({
      key: 'standings', marker: '排', label: '积分榜', description: '排名、积分与赛果',
      enabled: workspace.capabilities.canViewStandings,
    }),
    standard({
      key: 'assets', marker: '资', label: '球队资产', description: '阵容、工资与总价值',
      enabled: workspace.capabilities.canViewAssets,
    }),
    standard({
      key: 'transactions', marker: '交', label: '交易记录', description: '买卖双方与手续费', enabled: true,
    }),
    standard({
      key: 'finance', marker: '财', label: '球队财务', description: '赛季流水与实时总额',
      enabled: workspace.capabilities.canViewFinance,
    }),
    {
      key: 'valuations', marker: '价', label: '身价管理', description: '整队申报球员身价',
      stateLabel: workspace.capabilities.canManageValuations ? '窗口开放' : '窗口未开放',
      enabled: workspace.capabilities.canManageValuations,
      tone: workspace.capabilities.canManageValuations ? 'active' : 'locked',
    },
    standard({
      key: 'cups', marker: '杯', label: '杯赛中心', description: '报名、分组与淘汰签表', enabled: true,
    }),
    {
      key: 'favorites', marker: '藏', label: '我的收藏', description: '查看球员当前最强卡片',
      stateLabel: '个人球探簿', enabled: true, tone: 'personal', wide: true,
    },
  ]
}

export function workspaceModuleRoute(key: string, workspace: LeagueWorkspaceResponse): string | null {
  const item = workspaceModules(workspace).find((module) => module.key === key)
  if (!item?.enabled) return null
  const leagueId = encodeURIComponent(workspace.leagueId)
  const seasonId = encodeURIComponent(workspace.seasonId)
  const teamId = encodeURIComponent(workspace.team.leagueTeamId)
  const teamName = encodeURIComponent(workspace.team.name)
  const routes: Record<WorkspaceModuleKey, string> = {
    standings: `/pages/season-standings/index?leagueId=${leagueId}&seasonId=${seasonId}&teamName=${teamName}`,
    assets: `/pages/team-assets/index?teamId=${teamId}`,
    transactions: `/pages/league-transactions/index?leagueId=${leagueId}`,
    finance: `/pages/team-finance/index?teamId=${teamId}&seasonId=${seasonId}`,
    valuations: `/pages/valuation-manage/index?teamId=${teamId}`,
    cups: '/pages/competitions/index',
    favorites: '/pages/favorites/index',
  }
  return routes[item.key]
}

export function leagueDetailErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    VERSION_CONFLICT: '赛季或报名状态已变更，请刷新后重试',
    SEASON_ENTRY_ALREADY_EXISTS: '该赛季已有报名记录，请刷新查看',
    SEASON_REGISTRATION_CLOSED: '报名通道已关闭，请刷新查看最新状态',
    GAME_ACCOUNT_INELIGIBLE: '默认游戏账号的平台或区服不符合联赛要求',
    GAME_ACCOUNT_NOT_OWNED: '所选账号已不可用，请重新选择',
    NETWORK_ERROR: '网络连接失败，请稍后重试',
  }
  return messages[code] ?? '操作未完成，请刷新后重试'
}
