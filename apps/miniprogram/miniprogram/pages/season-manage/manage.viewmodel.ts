import type { LeagueDetail, LeagueSeasonDetail, LeagueSeasonStatus, SeasonEntryResponse, SeasonEntryStatus } from '@efm/contracts'

export type SeasonForm = {
  seasonNumber: number
  displayName: string
  registrationOpensAt: string
  registrationClosesAt: string
  startsAt: string
  endsAt: string
  superCapacity: string
  championCapacity: string
  promotionCount: string
}

export type QueueFilter = 'ALL' | SeasonEntryStatus

function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

export function buildSeasonForm(league: LeagueDetail, seasonNumber: number): SeasonForm {
  return {
    seasonNumber,
    displayName: `${league.shortName} S${seasonNumber}`,
    registrationOpensAt: new Date().toISOString(),
    registrationClosesAt: futureIso(7),
    startsAt: futureIso(8),
    endsAt: futureIso(45),
    superCapacity: String(league.defaultSuperCapacity),
    championCapacity: String(league.defaultChampionCapacity),
    promotionCount: String(league.defaultPromotionCount),
  }
}

export function managerTransitionAction(season: LeagueSeasonDetail) {
  if (!season.capabilities.canManage) return null
  if (season.status === 'DRAFT') return { kind: 'OPEN' as const, label: '开放报名' }
  if (season.status === 'REGISTRATION_OPEN') return { kind: 'CLOSE' as const, label: '关闭报名' }
  if (season.status === 'ALLOCATION_REVIEW') return { kind: 'NEXT_PHASE' as const, label: '下一阶段：分组确认' }
  return null
}

export function filterSeasonEntries(entries: SeasonEntryResponse[], filter: QueueFilter): SeasonEntryResponse[] {
  return filter === 'ALL' ? entries : entries.filter((entry) => entry.status === filter)
}

export function queueCounts(entries: SeasonEntryResponse[]) {
  return {
    invitedRenewals: entries.filter((entry) => entry.source === 'RENEWAL' && entry.status === 'INVITED').length,
    confirmedRenewals: entries.filter((entry) => entry.source === 'RENEWAL' && entry.status === 'APPROVED').length,
    newApplicants: entries.filter((entry) => entry.source === 'NEW_APPLICATION').length,
  }
}

export function isRejectionReasonValid(reason: string): boolean {
  return reason.trim().length > 0
}

export function seasonStatusLabel(status: LeagueSeasonStatus): string {
  const labels: Record<LeagueSeasonStatus, string> = {
    DRAFT: '草稿', REGISTRATION_OPEN: '报名中', ALLOCATION_REVIEW: '分组确认', READY: '待开赛',
    IN_PROGRESS: '进行中', COMPLETED: '已结束', CANCELLED: '已取消',
  }
  return labels[status]
}

export function entryStatusLabel(status: SeasonEntryStatus): string {
  const labels: Record<SeasonEntryStatus, string> = {
    INVITED: '待确认续赛', PENDING: '待审核', APPROVED: '已通过', REJECTED: '已拒绝', WITHDRAWN: '已撤回',
  }
  return labels[status]
}

export function seasonManagerErrorMessage(code: string): { message: string; refresh: boolean } {
  if (code === 'VERSION_CONFLICT') return { message: '赛季资料已更新，已为你重新加载', refresh: true }
  if (code === 'SEASON_FIELDS_LOCKED') return { message: '报名开放后不能再修改赛季规则', refresh: true }
  if (code === 'FORBIDDEN') return { message: '你没有管理这个赛季的权限', refresh: false }
  return { message: '操作失败，请稍后重试', refresh: false }
}
