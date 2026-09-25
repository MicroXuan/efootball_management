import type { CompetitionStatus, CompetitionSummary } from '@efm/contracts'

const lifecycleLabels: Record<CompetitionStatus, string> = {
  DRAFT: '筹备中',
  REGISTRATION_OPEN: '报名中',
  REGISTRATION_CLOSED: '报名截止',
  SCHEDULED: '待开赛',
  IN_PROGRESS: '进行中',
  COMPLETED: '已结束',
  CANCELLED: '已取消',
}

const errorCopy: Record<string, string> = {
  VERSION_CONFLICT: '页面信息已更新，请刷新后重试',
  REGISTRATION_CLOSED: '报名已经结束',
  REGISTRATION_FULL: '报名名额已满',
  GAME_ACCOUNT_INELIGIBLE: '游戏账号与赛事平台或区服不匹配',
  NETWORK_ERROR: '网络连接失败，请稍后重试',
}

export function lifecycleLabel(status: CompetitionStatus): string {
  return lifecycleLabels[status]
}

export function formatLocalDate(value: string, offsetMinutes = -new Date().getTimezoneOffset()): string {
  const date = new Date(Date.parse(value) + offsetMinutes * 60_000)
  const two = (number: number) => String(number).padStart(2, '0')
  return `${two(date.getUTCMonth() + 1)}月${two(date.getUTCDate())}日 ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`
}

export function mergeCompetitionPages(
  current: CompetitionSummary[],
  incoming: CompetitionSummary[],
): CompetitionSummary[] {
  const seen = new Set<string>()
  return [...current, ...incoming].filter(({ id }) => !seen.has(id) && Boolean(seen.add(id)))
}

export function competitionErrorMessage(error: { code?: string; message?: string }): string {
  return errorCopy[error.code ?? ''] ?? error.message ?? '赛事信息加载失败，请稍后重试'
}

export function toCompetitionCard(competition: CompetitionSummary, registrationStatus?: string) {
  return {
    ...competition,
    lifecycleName: lifecycleLabel(competition.status),
    deadlineLabel: formatLocalDate(competition.registrationClosesAt),
    capacityLabel: `${competition.participantCount}/${competition.participantLimit}`,
    registrationLabel: registrationStatus ? ({
      PENDING: '审核中', APPROVED: '已报名', REJECTED: '未通过', WITHDRAWN: '已撤回',
    } as Record<string, string>)[registrationStatus] ?? '' : '',
  }
}
