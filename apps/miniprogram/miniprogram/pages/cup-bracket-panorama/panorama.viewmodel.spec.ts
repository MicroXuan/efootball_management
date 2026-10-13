import { describe, expect, it } from 'vitest'
import type { CompetitionParticipantSummary, CupBracketView } from '@efm/contracts'
import { panoramaBoard } from './panorama.viewmodel'

describe('cup bracket panorama view model', () => {
  it('builds a wide board and enriches bracket teams with their crest and number', () => {
    const arsenal = { id: 'team-1', displayName: '阿森纳', teamLifecycleStatus: 'ACTIVE' as const }
    const chelsea = { id: 'team-2', displayName: '切尔西', teamLifecycleStatus: 'ACTIVE' as const }
    const pairing = {
      id: 'pair-1', pairingNumber: 1, homeParticipant: arsenal, awayParticipant: chelsea,
      winnerParticipant: arsenal, isBye: false,
      match: { id: 'match-1', status: 'COMPLETED' as const, homeScore: 2, awayScore: 1 },
    }
    const bracket = {
      competitionId: 'cup-1', proposalId: 'proposal-1', proposalVersion: 1,
      proposalStatus: 'CONFIRMED', bracketSize: 4, currentRoundNumber: 1,
      rounds: [{
        stageId: 'stage-1', roundNumber: 1, stageCode: 'SEMI_FINAL', displayName: '半决赛',
        status: 'PUBLISHED', pairings: [pairing, { ...pairing, id: 'pair-2', pairingNumber: 2 }],
      }, {
        stageId: 'stage-2', roundNumber: 2, stageCode: 'FINAL', displayName: '决赛',
        status: 'DRAFT', pairings: [{ ...pairing, id: 'pair-3', awayParticipant: null, match: null }],
      }],
    } as CupBracketView
    const participants = [{
      id: 'team-1', displayName: '阿森纳', participantType: 'TEAM', teamLifecycleStatus: 'ACTIVE',
      teamNumber: 3, teamName: '阿森纳', teamLogoUrl: 'https://example.com/arsenal.png', ownerDisplayName: '领队',
    }] as CompetitionParticipantSummary[]

    const board = panoramaBoard(bracket, participants)

    expect(board.width).toBeGreaterThan(1000)
    expect(board.height).toBeGreaterThanOrEqual(760)
    expect(board.rounds.map(({ topOffset, pairingGap }) => ({ topOffset, pairingGap }))).toEqual([
      { topOffset: 0, pairingGap: 16 },
      { topOffset: 74, pairingGap: 164 },
    ])
    expect(board.rounds[0]?.pairings[0]?.homeParticipant).toMatchObject({
      displayName: '阿森纳', teamNumber: 3, teamLogoUrl: 'https://example.com/arsenal.png',
    })
    expect(board.rounds[0]?.pairings[0]?.awayParticipant).toMatchObject({
      displayName: '切尔西', teamNumber: null, teamLogoUrl: null,
    })
  })
})
