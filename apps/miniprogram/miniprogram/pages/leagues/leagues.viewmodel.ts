import type { GamePlatform, LeagueSeasonStatus, LeagueSummary } from '@efm/contracts'

const platformLabels: Record<GamePlatform, string> = {
  MOBILE: '移动端',
  PLAYSTATION: 'PlayStation',
  XBOX: 'Xbox',
  STEAM: 'Steam',
}

export function seasonStatusLabel(status: LeagueSeasonStatus): string {
  const labels: Record<LeagueSeasonStatus, string> = {
    DRAFT: '筹备中',
    REGISTRATION_OPEN: '报名中',
    ALLOCATION_REVIEW: '分组确认',
    READY: '即将开赛',
    IN_PROGRESS: '进行中',
    COMPLETED: '已结束',
    CANCELLED: '已取消',
  }
  return labels[status]
}

export type LeagueCardView = LeagueSummary & {
  logoText: string
  seasonName: string
  seasonState: string
  eligibility: string
  entryCopy: string
}

export function leagueCardView(league: LeagueSummary): LeagueCardView {
  const season = league.featuredSeason
  return {
    ...league,
    logoText: league.shortName.slice(0, 2),
    seasonName: season?.displayName ?? '暂无公开赛季',
    seasonState: season ? seasonStatusLabel(season.status) : '待发布',
    eligibility: `${platformLabels[league.defaultPlatform]} · ${league.defaultServerRegion}`,
    entryCopy: season ? `${season.approvedEntryCount} 支球队已确认` : '等待联赛管理员发布',
  }
}

export function leagueListErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    NETWORK_ERROR: '网络连接失败，下拉或点击重试',
    INVALID_CURSOR: '联赛列表已更新，请重新加载',
  }
  return messages[code] ?? '暂时无法读取联赛，请稍后重试'
}
