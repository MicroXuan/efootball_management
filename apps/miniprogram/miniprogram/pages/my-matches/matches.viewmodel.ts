import type { CompetitionParticipantSummary, LeagueSeasonSummary, MyMatchResponse } from '@efm/contracts'
import { resultTime } from '../match-result/result.viewmodel'

function badgeText(name: string) {
  return Array.from(name).slice(0, 2).join('') || '队'
}

function participantView(participant: CompetitionParticipantSummary) {
  const name = participant.teamName ?? participant.displayName
  const number = participant.teamNumber === null ? '—' : String(participant.teamNumber).padStart(2, '0')
  return {
    identityCopy: `${number}-${name}`,
    ownerCopy: participant.ownerDisplayName ?? '用户名待补',
    badgeUrl: participant.teamLogoUrl,
    badgeText: badgeText(name),
    archived: participant.teamLifecycleStatus === 'ARCHIVED'
  }
}

function plannedAt(value: string | null) {
  return value ? `${value.slice(0, 10).replace(/-/g, '.')} ${value.slice(11, 16)}` : '时间待定'
}

export function matchCard(item: MyMatchResponse, now = Date.now()) {
  const side = item.match.homeParticipant.id === item.myParticipantId ? 'HOME' : 'AWAY'
  const result = item.match.officialResult
  const dispute = item.disputeSummary
  const confirmationExpired = !!item.confirmationDeadlineAt && now >= Date.parse(item.confirmationDeadlineAt)
  const evidenceExpired = !!dispute && now >= Date.parse(dispute.evidenceDeadlineAt)
  const nextActionCopy = result ? '查看最终结果'
    : dispute ? dispute.status === 'EVIDENCE_COLLECTION' && !evidenceExpired ? '查看或补交证据' : '查看争议进度'
    : confirmationExpired && item.myEvidenceRole === 'SUBMITTER' ? '上传证据并申请争议'
    : confirmationExpired ? '等待提交方申请争议'
    : item.action === 'SUBMIT' ? '提交比分'
    : item.action === 'CONFIRM' ? '确认或拒绝比分'
    : item.action === 'WAIT' && item.confirmationDeadlineAt ? '等待对手确认' : '查看比赛'
  return {
    ...item,
    matchId: item.match.id,
    scheduleMeta: `第 ${item.match.roundNumber} 轮 · ${side === 'HOME' ? '主场' : '客场'}`,
    plannedLabel: plannedAt(item.match.plannedAt),
    stateCopy: result ? '已结束' : '待比赛',
    resultCopy: result ? `${result.homeScore} : ${result.awayScore}` : '对阵',
    nextActionCopy,
    deadlineCopy: dispute ? `证据截止 ${resultTime(dispute.evidenceDeadlineAt)}`
      : item.confirmationDeadlineAt ? `确认截止 ${resultTime(item.confirmationDeadlineAt)}` : '',
    home: participantView(item.match.homeParticipant),
    away: participantView(item.match.awayParticipant)
  }
}

export function seasonOptions(seasons: LeagueSeasonSummary[], preferredSeasonId = '') {
  const sorted = [...seasons].sort((left, right) => right.seasonNumber - left.seasonNumber)
  const preferred = sorted.find((season) => season.id === preferredSeasonId)
    ?? sorted.find((season) => season.status === 'IN_PROGRESS')
    ?? sorted[0]
  return {
    items: sorted.map((season) => ({
      id: season.id,
      label: `${season.displayName}${season.status === 'IN_PROGRESS' ? '（当前）' : ''}`
    })),
    selectedIndex: Math.max(0, sorted.findIndex((season) => season.id === preferred?.id)),
    selectedSeasonId: preferred?.id ?? ''
  }
}
