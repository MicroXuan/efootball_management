import type { CompetitionStatus } from '@efm/contracts'

export function validateTimeline(value: { opens: number; closes: number; starts: number; ends: number }): string {
  if (value.opens >= value.closes) return '报名截止时间必须晚于开放时间'
  if (value.closes > value.starts) return '开赛时间不能早于报名截止时间'
  if (value.starts >= value.ends) return '结束时间必须晚于开赛时间'
  return ''
}

export function canEditCoreFields(status: CompetitionStatus): boolean {
  return status === 'DRAFT'
}

export function reviewReasonRequired(decision: 'APPROVE' | 'REJECT', reason: string): boolean {
  return decision === 'REJECT' && !reason.trim()
}

export function groupScheduleByRound<T extends { roundNumber: number }>(matches: T[]) {
  const groups = new Map<number, T[]>()
  for (const match of [...matches].sort((a, b) => a.roundNumber - b.roundNumber)) {
    groups.set(match.roundNumber, [...(groups.get(match.roundNumber) ?? []), match])
  }
  return [...groups].map(([roundNumber, roundMatches]) => ({ roundNumber, matches: roundMatches }))
}
