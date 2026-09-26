import { describe, expect, it } from 'vitest'
import { primaryAction } from './matches.viewmodel'

describe('my matches view model', () => {
  it.each([
    ['SUBMIT', '提交比分'], ['CONFIRM', '确认对手比分'], ['WAIT', '等待比赛或对手'], ['DONE', '查看结果'],
  ] as const)('maps %s to one primary action', (action, label) => {
    expect(primaryAction(action)).toEqual({ label, enabled: action !== 'WAIT' })
  })
})
