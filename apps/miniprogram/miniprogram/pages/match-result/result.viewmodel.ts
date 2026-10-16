import type { MyMatchResponse, ParticipantMatchResultDisputeResponse } from '@efm/contracts'

export type ResultForm = { homeScore: string; awayScore: string }
export type ResultState = 'SUBMIT' | 'WAIT_CONFIRM' | 'CONFIRM' | 'CONFIRMATION_EXPIRED' | 'EVIDENCE_COLLECTION' | 'READY_FOR_REVIEW' | 'DONE'

export function resultTime(value: string | null | undefined, offsetMinutes?: number): string {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const offset = offsetMinutes ?? new Date(timestamp).getTimezoneOffset()
  const local = new Date(timestamp - offset * 60_000).toISOString()
  return `${local.slice(0, 10).replace(/-/g, '.')} ${local.slice(11, 16)}`
}

const eventLabels: Record<string, string> = {
  RESULT_SUBMITTED: '比分已提交', RESULT_CONFIRMED: '比分已确认', RESULT_REJECTED: '比分被拒绝',
  CONFIRMATION_EXPIRED: '确认期限已结束', DISPUTE_OPENED: '争议已开启',
  EVIDENCE_UPLOADED: '证据已提交', EVIDENCE_REPLACED: '证据已替换',
  EVIDENCE_DEADLINE_EXPIRED: '证据收集结束', ADMIN_DECIDED: '管理员已裁决'
}

export function resultView(item: MyMatchResponse, dispute: ParticipantMatchResultDisputeResponse | null, now = Date.now()) {
  const deadline = item.confirmationDeadlineAt ?? item.match.resultConfirmationDeadlineAt
  const confirmationExpired = !!deadline && now >= Date.parse(deadline)
  const evidenceDeadline = dispute?.evidenceDeadlineAt ?? item.disputeSummary?.evidenceDeadlineAt ?? null
  const evidenceExpired = !!evidenceDeadline && now >= Date.parse(evidenceDeadline)
  const role = item.myEvidenceRole ?? null
  const ownEvidenceSubmitted = role === 'SUBMITTER' ? dispute?.evidencePresence.SUBMITTER
    : role === 'OPPONENT' ? dispute?.evidencePresence.OPPONENT : false
  let state: ResultState = 'WAIT_CONFIRM'
  if (item.action === 'DONE' || dispute?.status === 'RESOLVED' || dispute?.status === 'CANCELLED') state = 'DONE'
  else if (dispute?.status === 'READY_FOR_REVIEW' || (dispute?.status === 'EVIDENCE_COLLECTION' && evidenceExpired)) state = 'READY_FOR_REVIEW'
  else if (dispute?.status === 'EVIDENCE_COLLECTION') state = 'EVIDENCE_COLLECTION'
  else if (confirmationExpired && deadline) state = 'CONFIRMATION_EXPIRED'
  else if (item.action === 'SUBMIT') state = 'SUBMIT'
  else if (item.action === 'CONFIRM') state = 'CONFIRM'
  const labels: Record<ResultState, string> = {
    SUBMIT: '等待提交比分', WAIT_CONFIRM: '等待对手确认', CONFIRM: '请确认比分',
    CONFIRMATION_EXPIRED: '确认期限已到', EVIDENCE_COLLECTION: '证据收集中',
    READY_FOR_REVIEW: '等待管理员裁决', DONE: '结果已确定'
  }
  const score = item.match.officialResult ?? item.actionableResultVersion
  const submitted = [...item.timeline].reverse().find((event) => event.type === 'RESULT_SUBMITTED')
  const submittedHome = submitted?.metadata?.homeScore
  const submittedAway = submitted?.metadata?.awayScore
  const submittedScore = Number.isInteger(submittedHome) && Number.isInteger(submittedAway)
    && Number(submittedHome) >= 0 && Number(submittedHome) <= 99 && Number(submittedAway) >= 0 && Number(submittedAway) <= 99
    ? `${submittedHome} : ${submittedAway}` : '— : —'
  return {
    state, statusLabel: labels[state], myRole: role,
    scoreCopy: score ? `${score.homeScore} : ${score.awayScore}` : submittedScore,
    deadlineCopy: state === 'DONE' ? '赛果已确定'
      : state === 'SUBMIT' ? '等待你提交比分'
      : state === 'EVIDENCE_COLLECTION' || state === 'READY_FOR_REVIEW'
      ? `证据截止 ${resultTime(evidenceDeadline)}`
      : deadline ? `确认截止 ${resultTime(deadline)}` : '等待比赛进入赛果阶段',
    canOpenTimeout: state === 'CONFIRMATION_EXPIRED' && role === 'SUBMITTER',
    canUploadEvidence: (state === 'EVIDENCE_COLLECTION' || state === 'READY_FOR_REVIEW') && !evidenceExpired && role !== null,
    canReplaceEvidence: state === 'READY_FOR_REVIEW' && !evidenceExpired && role !== null && !!ownEvidenceSubmitted,
    evidence: [
      { role: 'SUBMITTER', submitted: dispute?.evidencePresence.SUBMITTER ?? false },
      { role: 'OPPONENT', submitted: dispute?.evidencePresence.OPPONENT ?? false }
    ],
    evidenceStatus: {
      submitter: dispute?.evidencePresence.SUBMITTER ? '已提交' : '未提交',
      opponent: dispute?.evidencePresence.OPPONENT ? '已提交' : '未提交'
    },
    timeline: item.timeline.flatMap((event) => {
      const label = eventLabels[event.type]
      if (!label) return []
      const reason = (event.type === 'RESULT_REJECTED' || event.type === 'ADMIN_DECIDED')
        && typeof event.metadata?.reason === 'string' ? event.metadata.reason : ''
      return [{ label, at: resultTime(event.occurredAt), reason }]
    })
  }
}

export function validateScore(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null
  const score = Number(value)
  return Number.isInteger(score) && score >= 0 && score <= 99 ? score : null
}

export function resultConflictMessage(code: string) {
  return code === 'VERSION_CONFLICT'
    ? { message: '比赛结果已被更新，请重新确认', reloadRequired: true }
    : { message: code === 'NETWORK_ERROR' ? '网络连接失败，请稍后重试' : '比分操作失败，请稍后重试', reloadRequired: false }
}

export function nextResultForm(form: ResultForm, errorCode: string) {
  const conflict = resultConflictMessage(errorCode)
  return { ...form, errorMessage: conflict.message, reloadRequired: conflict.reloadRequired }
}
