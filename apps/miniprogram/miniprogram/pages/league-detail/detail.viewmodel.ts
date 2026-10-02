import type { LeagueSeasonStatus, LeagueSeasonSummary, SeasonEntryResponse } from '@efm/contracts'

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
