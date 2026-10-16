import { describe, expect, it } from 'vitest'
import { nextResultForm, resultConflictMessage, resultTime, resultView, validateScore } from './result.viewmodel'
import type { MyMatchResponse, ParticipantMatchResultDisputeResponse } from '@efm/contracts'

describe('match result view model', () => {
  it('accepts integer scores from 0 through 99 only', () => {
    expect(validateScore('0')).toBe(0)
    expect(validateScore('99')).toBe(99)
    expect(validateScore('-1')).toBeNull()
    expect(validateScore('1.5')).toBeNull()
    expect(validateScore('100')).toBeNull()
  })

  it('renders deadline time in the participant device time zone', () => {
    expect(resultTime('2026-10-17T16:00:00.000Z', -480)).toBe('2026.10.18 00:00')
  })

  it('preserves entered values after a network error', () => {
    expect(nextResultForm({ homeScore: '3', awayScore: '2' }, 'NETWORK_ERROR')).toEqual({
      homeScore: '3', awayScore: '2', errorMessage: '网络连接失败，请稍后重试', reloadRequired: false,
    })
  })

  it('requires reload on version conflict instead of silent resubmission', () => {
    expect(resultConflictMessage('VERSION_CONFLICT')).toEqual({
      message: '比赛结果已被更新，请重新确认', reloadRequired: true,
    })
  })

  const item = (action: MyMatchResponse['action'], own = true): MyMatchResponse => ({
    action, myParticipantId: 'home', myEvidenceRole: own ? 'SUBMITTER' : 'OPPONENT', evidenceRequired: false, confirmationDeadlineAt: '2026-10-17T00:00:00.000Z',
    disputeSummary: null, timeline: [{ type: 'RESULT_SUBMITTED', actorUserId: own ? 'me' : 'other', occurredAt: '2026-10-16T00:00:00.000Z', metadata: { homeScore: 2, awayScore: 1 } }], actionableResultVersion: action === 'CONFIRM' ? { version: 1, homeScore: 2, awayScore: 1 } : null,
    match: { id: 'match-1', version: 2, status: 'PENDING_CONFIRMATION', homeParticipant: { id: 'home', displayName: '主队' }, awayParticipant: { id: 'away', displayName: '客队' }, officialResult: null,
      resultVersions: [{ version: 1, submittedByMe: own, homeScore: 2, awayScore: 1 }] },
    competition: { name: '联赛' }
  } as unknown as MyMatchResponse)
  const dispute = (status: ParticipantMatchResultDisputeResponse['status']): ParticipantMatchResultDisputeResponse => ({
    id: 'dispute-1', matchId: 'match-1', trigger: 'REJECTED', status, evidenceDeadlineAt: '2026-10-18T00:00:00.000Z', matchVersion: 3,
    evidencePresence: { SUBMITTER: true, OPPONENT: false }
  })

  it('maps a submitter after the 24-hour deadline to timeout evidence action', () => {
    expect(resultView(item('WAIT'), null, Date.parse('2026-10-17T00:00:00.000Z'))).toMatchObject({ state: 'CONFIRMATION_EXPIRED', canOpenTimeout: true, myRole: 'SUBMITTER' })
    expect(resultView(item('CONFIRM', false), null, Date.parse('2026-10-17T00:00:00.000Z'))).toMatchObject({ state: 'CONFIRMATION_EXPIRED', canOpenTimeout: false })
  })

  it('keeps the submitted score visible while the submitter waits', () => {
    expect(resultView(item('WAIT'), null)).toMatchObject({ state: 'WAIT_CONFIRM', scoreCopy: '2 : 1' })
  })

  it('shows only presence for each role during evidence collection', () => {
    expect(resultView(item('WAIT'), dispute('EVIDENCE_COLLECTION'), Date.parse('2026-10-16T12:00:00.000Z'))).toMatchObject({
      state: 'EVIDENCE_COLLECTION', myRole: 'SUBMITTER', canUploadEvidence: true,
      evidence: [{ role: 'SUBMITTER', submitted: true }, { role: 'OPPONENT', submitted: false }]
    })
    expect(JSON.stringify(resultView(item('WAIT'), dispute('EVIDENCE_COLLECTION')))).not.toMatch(/objectKey|uploadUrl|checksum|readUrl/)
  })

  it('locks evidence after the deadline and exposes resolved timeline with reason', () => {
    expect(resultView(item('WAIT'), dispute('READY_FOR_REVIEW'), Date.parse('2026-10-18T00:00:00.000Z'))).toMatchObject({ state: 'READY_FOR_REVIEW', canUploadEvidence: false })
    const resolved = { ...item('DONE'), match: { ...item('DONE').match, officialResult: { resultVersionId: 'result-2', version: 2, homeScore: 3, awayScore: 2, status: 'OFFICIAL' as const } },
      timeline: [{ type: 'ADMIN_DECIDED', occurredAt: '2026-10-18T12:00:00.000Z', metadata: { reason: '截图有效', objectKey: 'secret' } }] } as unknown as MyMatchResponse
    expect(resultView(resolved, dispute('RESOLVED'))).toMatchObject({ state: 'DONE', deadlineCopy: '赛果已确定' })
    expect(resultView(resolved, dispute('RESOLVED')).timeline).toContainEqual({ label: '管理员已裁决', at: resultTime('2026-10-18T12:00:00.000Z'), reason: '截图有效' })
  })

  it('keeps the own evidence replace action in ready state until the evidence deadline', () => {
    const ready = { ...dispute('READY_FOR_REVIEW'), evidencePresence: { SUBMITTER: true, OPPONENT: true } }
    expect(resultView(item('WAIT'), ready, Date.parse('2026-10-17T12:00:00.000Z'))).toMatchObject({
      state: 'READY_FOR_REVIEW', canUploadEvidence: true, canReplaceEvidence: true, myRole: 'SUBMITTER'
    })
    expect(resultView(item('WAIT', false), ready, Date.parse('2026-10-17T12:00:00.000Z'))).toMatchObject({
      state: 'READY_FOR_REVIEW', canUploadEvidence: true, canReplaceEvidence: true, myRole: 'OPPONENT'
    })
    expect(resultView(item('WAIT'), ready, Date.parse(ready.evidenceDeadlineAt))).toMatchObject({
      state: 'READY_FOR_REVIEW', canUploadEvidence: false, canReplaceEvidence: false
    })
  })

  it('keeps evidence deletion visible in the participant audit timeline', () => {
    const resolved = { ...item('DONE'), timeline: [{ type: 'EVIDENCE_DELETED', occurredAt: '2026-10-18T12:00:00.000Z', metadata: {} }] } as unknown as MyMatchResponse
    expect(resultView(resolved, dispute('RESOLVED')).timeline)
      .toContainEqual({ label: '证据已按保留规则清理', at: resultTime('2026-10-18T12:00:00.000Z'), reason: '' })
  })
})
