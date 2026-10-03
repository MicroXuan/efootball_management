import type { DivisionStandingsResponse } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { initialStageIndex, standingRows, standingsErrorMessage, standingsTabs, type StandingsRowResponse } from './standings.viewmodel'

const row = (overrides: Partial<StandingsRowResponse> = {}): StandingsRowResponse => ({
  participantId: 'participant-1', displayName: '海港', played: 4, wins: 3, draws: 1, losses: 0,
  goalsFor: 9, goalsAgainst: 3, goalDifference: 6, basePoints: 10, adjustmentPoints: 0,
  totalPoints: 10, rank: 1, tiePending: false, tieBreakValues: {}, ...overrides,
})

const response = (): DivisionStandingsResponse => ({
  seasonId: 'season-1', competitionId: 'competition-1', myStageId: 'stage-b', groups: [
    { stage: { id: 'stage-a', competitionId: 'competition-1', stageCode: 'CHAMPION_A', displayName: '冠军 A 组', sequence: 1, capacity: 18, format: 'ROUND_ROBIN', status: 'PUBLISHED', participantCount: 18, version: 1 }, standings: { competitionId: 'competition-1', stageId: 'stage-a', version: 1, ruleVersion: 1, triggeringResultVersionId: null, generatedAt: null, rows: [] } },
    { stage: { id: 'stage-b', competitionId: 'competition-1', stageCode: 'CHAMPION_B', displayName: '冠军 B 组', sequence: 2, capacity: 18, format: 'ROUND_ROBIN', status: 'PUBLISHED', participantCount: 9, version: 1 }, standings: { competitionId: 'competition-1', stageId: 'stage-b', version: 1, ruleVersion: 1, triggeringResultVersionId: null, generatedAt: null, rows: [row()] } },
  ],
})

describe('season standings view model', () => {
  it('labels champion and super groups and starts from my group', () => {
    const data = response()
    data.groups.unshift({ ...data.groups[0]!, stage: { ...data.groups[0]!.stage, id: 'stage-super', stageCode: 'SUPER', displayName: '超级组' } })
    expect(standingsTabs(data).map((tab) => tab.label)).toEqual(['超级组', '冠军 A 组', '冠军 B 组'])
    expect(initialStageIndex(data)).toBe(2)
  })

  it('supports first-season champion-only and an empty table', () => {
    const data = response()
    data.groups = data.groups.slice(0, 1)
    data.myStageId = null
    expect(standingsTabs(data)).toHaveLength(1)
    expect(initialStageIndex(data)).toBe(0)
    expect(data.groups[0]!.standings.rows).toEqual([])
  })

  it('marks pending ties and highlights my team', () => {
    expect(standingRows([row({ tiePending: true })], '海港')[0]).toMatchObject({ rankLabel: '1*', tieLabel: '同分待定', isMine: true })
  })

  it('provides Chinese retry and access messages', () => {
    expect(standingsErrorMessage('NETWORK_ERROR')).toContain('重试')
    expect(standingsErrorMessage('DIVISION_STANDINGS_FORBIDDEN')).toContain('报名审核通过')
  })
})
