import type {
  LeagueEdition,
  LeagueSeasonStatus,
  LeagueSummary,
  MyLeagueTeamSummary,
  PlatformPresentation,
} from '@efm/contracts'

export type LeagueListTab = 'all' | 'mine'

export function leagueBannerView(presentation: PlatformPresentation) {
  return {
    imageUrl: presentation.leagueCenterBannerUrl ?? '',
    hasImage: Boolean(presentation.leagueCenterBannerUrl),
  }
}

export type LeagueCardView = {
  id: string
  displayName: string
  description: string
  logoUrl: string | null
  logoText: string
  editionLabel: string
  seasonName: string
  seasonState: string
  seasonTone: 'accent' | 'info' | 'warning' | 'muted' | 'danger'
  entryCopy: string
  teamName: string
}

export function seasonStatusTone(
  status: LeagueSeasonStatus | null,
): LeagueCardView['seasonTone'] {
  if (!status || status === 'DRAFT' || status === 'COMPLETED') return 'muted'
  if (status === 'REGISTRATION_OPEN' || status === 'IN_PROGRESS') return 'accent'
  if (status === 'ALLOCATION_REVIEW') return 'warning'
  if (status === 'READY') return 'info'
  return 'danger'
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

export function editionLabel(edition: LeagueEdition): string {
  return edition === 'NATIONAL' ? '国服' : '国际服'
}

function fallbackLogoText(primary: string, secondary: string): string {
  const source = primary.trim() || secondary.trim() || '联赛'
  return source.slice(0, 2)
}

export function leagueCardView(league: LeagueSummary): LeagueCardView {
  const season = league.currentSeason
  return {
    id: league.id,
    displayName: league.name.trim() || '未命名联赛',
    description: league.description.trim() || '暂无联赛说明',
    logoUrl: league.logoUrl,
    logoText: fallbackLogoText(league.shortName, league.name),
    editionLabel: editionLabel(league.edition),
    seasonName: season?.displayName || '暂无当前赛季',
    seasonState: season ? seasonStatusLabel(season.status) : '待发布',
    seasonTone: seasonStatusTone(season?.status ?? null),
    entryCopy: season ? `${season.approvedEntryCount} 支球队参赛` : '等待管理员设置赛季',
    teamName: '',
  }
}

export function myLeagueCardView(team: MyLeagueTeamSummary): LeagueCardView {
  const season = team.currentSeason
  return {
    id: team.leagueId,
    displayName: team.leagueName.trim() || '未命名联赛',
    description: team.leagueDescription.trim() || '暂无联赛说明',
    logoUrl: team.leagueLogoUrl,
    logoText: fallbackLogoText(team.shortName, team.leagueName),
    editionLabel: editionLabel(team.leagueEdition),
    seasonName: season?.displayName || '暂无当前赛季',
    seasonState: season ? seasonStatusLabel(season.status) : '待发布',
    seasonTone: seasonStatusTone(season?.status ?? null),
    entryCopy: season ? `${season.approvedEntryCount} 支球队参赛` : '等待管理员设置赛季',
    teamName: team.name.trim() || '未命名球队',
  }
}

export function selectLeagueCards(
  tab: LeagueListTab,
  all: readonly LeagueCardView[],
  mine: readonly LeagueCardView[],
): LeagueCardView[] {
  return [...(tab === 'mine' ? mine : all)]
}

export function leagueListErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    NETWORK_ERROR: '网络连接失败，下拉或点击重试',
    INVALID_CURSOR: '联赛列表已更新，请重新加载',
    AUTH_REQUIRED: '登录后才能查看我的联赛',
  }
  return messages[code] ?? '暂时无法读取联赛，请稍后重试'
}
