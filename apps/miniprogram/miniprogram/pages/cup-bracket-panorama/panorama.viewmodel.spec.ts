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

  it('splits the knockout route into two readable halves that meet in the final', () => {
    const team = (id: string) => ({ id, displayName: id, teamLifecycleStatus: 'ACTIVE' as const })
    const pairing = (id: string, number: number, home: string, away: string) => ({
      id, pairingNumber: number, homeParticipant: team(home), awayParticipant: team(away),
      winnerParticipant: team(home), isBye: false,
      match: { id: `match-${id}`, status: 'CONFIRMED' as const, homeScore: 2, awayScore: 0 },
    })
    const bracket = {
      competitionId: 'cup-1', proposalId: 'proposal-1', proposalVersion: 1,
      proposalStatus: 'CONFIRMED', bracketSize: 8, currentRoundNumber: 3,
      rounds: [{
        stageId: 'quarter', roundNumber: 1, stageCode: 'QUARTER_FINAL', displayName: '四分之一决赛', status: 'PUBLISHED',
        pairings: [
          pairing('q1', 1, 'team-1', 'team-2'), pairing('q2', 2, 'team-3', 'team-4'),
          pairing('q3', 3, 'team-5', 'team-6'), pairing('q4', 4, 'team-7', 'team-8'),
        ],
      }, {
        stageId: 'semi', roundNumber: 2, stageCode: 'SEMI_FINAL', displayName: '半决赛', status: 'PUBLISHED',
        pairings: [pairing('s1', 1, 'team-1', 'team-3'), pairing('s2', 2, 'team-5', 'team-7')],
      }, {
        stageId: 'final', roundNumber: 3, stageCode: 'FINAL', displayName: '决赛', status: 'PUBLISHED',
        pairings: [pairing('f1', 1, 'team-1', 'team-5')],
      }],
    } as CupBracketView

    const board = panoramaBoard(bracket, [], 'team-1')

    expect(board.routeSections.map((section) => ({
      key: section.key,
      rounds: section.rounds.map((round) => round.pairings.map(({ id }) => id)),
    }))).toEqual([
      { key: 'upper', rounds: [['q1', 'q2'], ['s1']] },
      { key: 'lower', rounds: [['q3', 'q4'], ['s2']] },
      { key: 'final', rounds: [['f1']] },
    ])
    expect(board.routeSections[0]?.rounds[0]?.pairings[0]).toMatchObject({
      isMyMatch: true,
      homeParticipant: { isMine: true },
    })
    expect(board.routeSections[1]?.rounds[0]?.pairings[0]?.isMyMatch).toBe(false)
    expect(board.myRouteSections.map((section) => ({
      key: section.key,
      pairings: section.rounds.flatMap((round) => round.pairings.map(({ id }) => id)),
    }))).toEqual([
      { key: 'upper', pairings: ['q1', 's1'] },
      { key: 'final', pairings: ['f1'] },
    ])
  })
})
