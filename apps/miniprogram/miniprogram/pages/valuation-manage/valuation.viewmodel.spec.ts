import type { ValuationSubmissionStatus, ValuationWorkspace } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { countdownCopy, submissionStateCopy, validateValuationInput, valuationInputState, valuationPlayerView, valuationSummary } from './valuation.viewmodel'

const workspace = (status: ValuationSubmissionStatus | null = 'DRAFT'): ValuationWorkspace => ({
  window: { id: 'window-1', name: '季前申报', state: 'OPEN', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-04T12:00:00.000Z', rule: { id: 'rule-1', version: 1, minimumValueMinor: 100, maximumValueMinor: 10000, maximumIncreaseBps: 2000, maximumDecreaseBps: 1000 } },
  team: { id: 'team-1', name: '海港竞技' },
  submission: status ? { id: 'submission-1', windowId: 'window-1', leagueTeamId: 'team-1', ruleVersionId: 'rule-1', attemptNumber: 1, status, submittedAt: null, reviewedAt: null, reviewReason: status === 'REJECTED' ? '调整幅度过大' : null, version: 1 } : null,
  players: [{ snapshotId: 'snapshot-1', playerId: 'player-1', playerName: '球员甲', cardName: '精选卡', cardImageUrl: null, rosterStatus: 'ACTIVE', baseValueMinor: 1000, currentValueMinor: 1000, minimumAllowedMinor: 900, maximumAllowedMinor: 1200, draftValueMinor: 1100, exceedsRange: false }, { snapshotId: 'snapshot-2', playerId: 'player-2', playerName: '球员乙', cardName: '基础卡', cardImageUrl: null, rosterStatus: 'ACTIVE', baseValueMinor: null, currentValueMinor: null, minimumAllowedMinor: 100, maximumAllowedMinor: 10000, draftValueMinor: null, exceedsRange: false }],
})

describe('valuation management view model', () => {
  it('formats countdown, current values, ranges, and draft change states', () => {
    const value = workspace()
    expect(countdownCopy(value, new Date('2026-10-02T12:00:00.000Z'))).toBe('距离关闭还有 2 天 0 小时')
    const players = value.players.map(valuationPlayerView)
    expect(players[0]).toMatchObject({ currentValueCopy: '1000', allowedRangeCopy: '900 — 1200', changeState: '已修改' })
    expect(players[1]).toMatchObject({ currentValueCopy: '首次申报', changeState: '首次必填' })
    expect(valuationSummary(players)).toMatchObject({ changedCount: 1, missingCount: 1, complete: false })
  })

  it('allows percentage-limit exceptions to enter review while rejecting invalid numbers', () => {
    const player = workspace().players[0]!
    expect(validateValuationInput('1000.5')).toBe('请输入非负整数身价')
    expect(validateValuationInput('1300')).toBeNull()
    expect(valuationInputState('1300', player)).toBe('超出范围')
    expect(validateValuationInput('1100')).toBeNull()
  })

  it('presents pending, rejected retry, and closed read-only states in Chinese', () => {
    expect(submissionStateCopy(workspace('PENDING_REVIEW'))).toBe('待管理员整批审核')
    expect(submissionStateCopy(workspace('REJECTED'))).toBe('已驳回，可修改后重新提交')
    const closed = workspace(); closed.window.state = 'CLOSED'
    expect(countdownCopy(closed)).toBe('申报已关闭，仅可查看')
  })
})
