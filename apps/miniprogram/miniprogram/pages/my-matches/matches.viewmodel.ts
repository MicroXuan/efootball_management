import type { CompetitionParticipantSummary, LeagueSeasonSummary, SeasonFixtureListItem } from '@efm/contracts'

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

export function matchCard(item: SeasonFixtureListItem) {
  const result = item.match.officialResult
  return {
    ...item,
    matchId: item.match.id,
    scheduleMeta: `第 ${item.match.roundNumber} 轮 · ${item.match.stageDisplayName ?? '赛程'}`,
    plannedLabel: plannedAt(item.match.plannedAt),
    stateCopy: result || item.match.advancement ? '已结束' : '未开始',
    resultCopy: item.match.advancement ? '裁定晋级（无比分）' : result ? `${result.homeScore} : ${result.awayScore}` : '对阵',
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
