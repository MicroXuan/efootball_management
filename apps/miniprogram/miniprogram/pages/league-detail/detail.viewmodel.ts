import type {
  GameAccountResponse,
  LeagueSeasonStatus,
  LeagueSeasonSummary,
  SeasonEntryResponse,
  TeamProfileResponse,
} from '@efm/contracts'

export type SeasonAction = {
  kind: 'LOGIN' | 'TEAM_PROFILE' | 'APPLY' | 'RENEW' | 'WITHDRAW' | 'NONE'
  label: string
  tone: 'primary' | 'secondary' | 'muted'
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

export function deriveSeasonAction(
  hasTeamProfile: boolean,
  entry: SeasonEntryResponse | null,
  seasonStatus: LeagueSeasonStatus,
  isAuthenticated = true,
): SeasonAction {
  if (!isAuthenticated) return { kind: 'LOGIN', label: '登录后报名', tone: 'primary' }
  if (!hasTeamProfile) return { kind: 'TEAM_PROFILE', label: '先建立球队档案', tone: 'primary' }
  const registrationOpen = seasonStatus === 'REGISTRATION_OPEN'
  if (!entry) {
    return registrationOpen
      ? { kind: 'APPLY', label: '报名参加', tone: 'primary' }
      : { kind: 'NONE', label: '当前未开放报名', tone: 'muted' }
  }
  if (entry.status === 'INVITED') {
    return registrationOpen
      ? { kind: 'RENEW', label: '确认参加下一赛季', tone: 'primary' }
      : { kind: 'NONE', label: '续赛确认已截止', tone: 'muted' }
  }
  if (entry.status === 'PENDING') {
    return registrationOpen
      ? { kind: 'WITHDRAW', label: '审核中 · 撤回报名', tone: 'secondary' }
      : { kind: 'NONE', label: '审核中', tone: 'muted' }
  }
  if (entry.status === 'APPROVED') {
    return registrationOpen
      ? { kind: 'WITHDRAW', label: '已通过 · 撤回报名', tone: 'secondary' }
      : { kind: 'NONE', label: '已通过审核', tone: 'muted' }
  }
  if (entry.status === 'REJECTED') return { kind: 'NONE', label: '报名未通过', tone: 'muted' }
  return { kind: 'NONE', label: '已撤回报名', tone: 'muted' }
}

export function defaultSeasonAccountId(
  profile: TeamProfileResponse | null,
  accounts: readonly GameAccountResponse[],
): string {
  const profileAccount = accounts.find((account) => account.id === profile?.defaultGameAccountId)
  return profileAccount?.id ?? accounts.find((account) => account.isDefault)?.id ?? accounts[0]?.id ?? ''
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
