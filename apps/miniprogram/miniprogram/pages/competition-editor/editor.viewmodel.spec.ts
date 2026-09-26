import { describe, expect, it } from 'vitest'
import { canCancelCompetition, canEditCoreFields, groupScheduleByRound, reviewReasonRequired, validateTimeline } from './editor.viewmodel'

describe('competition manager form', () => {
  it('validates registration and competition timeline order', () => {
    expect(validateTimeline({ opens: 1, closes: 2, starts: 3, ends: 4 })).toBe('')
    expect(validateTimeline({ opens: 2, closes: 1, starts: 3, ends: 4 })).toContain('报名截止')
    expect(validateTimeline({ opens: 1, closes: 2, starts: 4, ends: 3 })).toContain('结束时间')
  })

  it('locks core fields after registration opens and requires reject reasons', () => {
    expect(canEditCoreFields('DRAFT')).toBe(true)
    expect(canEditCoreFields('REGISTRATION_OPEN')).toBe(false)
    expect(reviewReasonRequired('REJECT', '')).toBe(true)
    expect(reviewReasonRequired('APPROVE', '')).toBe(false)
  })

  it('groups schedule matches by round for publication review', () => {
    expect(groupScheduleByRound([
      { id: 'a', roundNumber: 2 }, { id: 'b', roundNumber: 1 }, { id: 'c', roundNumber: 2 },
    ])).toEqual([
      { roundNumber: 1, matches: [{ id: 'b', roundNumber: 1 }] },
      { roundNumber: 2, matches: [{ id: 'a', roundNumber: 2 }, { id: 'c', roundNumber: 2 }] },
    ])
  })

  it('allows cancellation only before a terminal state', () => {
    expect(canCancelCompetition('DRAFT')).toBe(true)
    expect(canCancelCompetition('IN_PROGRESS')).toBe(true)
    expect(canCancelCompetition('COMPLETED')).toBe(false)
    expect(canCancelCompetition('CANCELLED')).toBe(false)
  })
})
