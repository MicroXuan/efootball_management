import { describe, expect, it } from 'vitest'
import { nextResultForm, resultConflictMessage, validateScore } from './result.viewmodel'

describe('match result view model', () => {
  it('accepts integer scores from 0 through 99 only', () => {
    expect(validateScore('0')).toBe(0)
    expect(validateScore('99')).toBe(99)
    expect(validateScore('-1')).toBeNull()
    expect(validateScore('1.5')).toBeNull()
    expect(validateScore('100')).toBeNull()
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
})
