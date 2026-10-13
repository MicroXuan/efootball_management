import { describe, expect, it } from 'vitest'
import type { CompetitionDetail, CompetitionMatchResponse, CupBracketView, GameAccountResponse, StandingsSnapshotResponse } from '@efm/contracts'
import * as detailViewModel from './detail.viewmodel'

const { cupRegistrationAvailability, eligibleAccounts, isCupCompetition, registrationAvailability, standingsEmpty } = detailViewModel

const detail = {
  id: 'competition-1', platform: 'MOBILE', serverRegion: 'GLOBAL', status: 'REGISTRATION_OPEN',
  participantCount: 3, participantLimit: 8, activeRuleVersion: 2, currentRegistration: null,
} as CompetitionDetail

function account(id: string, platform: GameAccountResponse['platform'], serverRegion: string): GameAccountResponse {
  return { id, platform, serverRegion, gamerTag: id, gameUid: null, isDefault: false, verificationStatus: 'UNVERIFIED',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }
}

describe('competition detail view model', () => {
  it('filters accounts by exact platform and region and explains disabled entries', () => {
    const result = eligibleAccounts([
      account('ok', 'MOBILE', 'GLOBAL'),
      account('platform', 'STEAM', 'GLOBAL'),
      account('region', 'MOBILE', 'ASIA'),
    ], detail)
    expect(result.map(({ id, eligible }) => ({ id, eligible }))).toEqual([
      { id: 'ok', eligible: true }, { id: 'platform', eligible: false }, { id: 'region', eligible: false },
    ])
    expect(result[1]?.disabledReason).toContain('平台')
    expect(result[2]?.disabledReason).toContain('区服')
  })

  it('requires an open event, capacity, no active registration, and an eligible account', () => {
    expect(registrationAvailability(detail, 1)).toEqual({ enabled: true, reason: '' })
    expect(registrationAvailability({ ...detail, participantCount: 8 }, 1).reason).toBe('报名名额已满')
    expect(registrationAvailability(detail, 0).reason).toBe('没有符合平台和区服要求的游戏账号')
  })

  it('recognizes a version-zero standings empty state', () => {
    expect(standingsEmpty({ version: 0, rows: [] } as unknown as StandingsSnapshotResponse)).toBe(true)
    expect(standingsEmpty({ version: 1, rows: [{ participantId: 'x' }] } as unknown as StandingsSnapshotResponse)).toBe(false)
  })

  it('shows the bracket only for season cups', () => {
    expect(isCupCompetition({ ...detail, competitionType: 'KNOCKOUT_CUP' })).toBe(true)
    expect(isCupCompetition({ ...detail, competitionType: 'GROUP_KNOCKOUT_CUP' })).toBe(true)
    expect(isCupCompetition({ ...detail, competitionType: 'OPEN_EVENT' })).toBe(false)
  })

  it('requires an approved owned season team when registering for a cup', () => {
    const cup = { ...detail, competitionType: 'KNOCKOUT_CUP' as const }
    expect(cupRegistrationAvailability(cup, { status: 'APPROVED' }, null)).toEqual({ enabled: true, reason: '' })
    expect(cupRegistrationAvailability(cup, null, null).reason).toBe('你还没有本赛季的参赛球队')
    expect(cupRegistrationAvailability(cup, { status: 'PENDING' }, null).reason).toBe('赛季球队尚未通过审核')
    expect(cupRegistrationAvailability(cup, { status: 'APPROVED' }, { status: 'APPROVED' }).reason).toBe('球队已经报名')
  })

  it('lays out every knockout round as one aligned tournament board', () => {
    const build = (detailViewModel as unknown as {
      bracketBoardRounds?: (bracket: CupBracketView) => Array<{ topOffset: number; pairingGap: number }>
    }).bracketBoardRounds
    expect(build).toBeTypeOf('function')
    if (!build) return
    const participant = { id: 'team-1', displayName: '阿森纳', teamLifecycleStatus: 'ACTIVE' as const }
    const pairing = {
      id: 'pair-1', pairingNumber: 1, homeParticipant: participant, awayParticipant: participant,
      winnerParticipant: null, isBye: false, match: null,
    }
    const bracket = {
      competitionId: 'cup-1', proposalId: 'proposal-1', proposalVersion: 1,
      proposalStatus: 'CONFIRMED', bracketSize: 4, currentRoundNumber: 1,
      rounds: [{
        stageId: 'stage-1', roundNumber: 1, stageCode: 'SEMI_FINAL', displayName: '半决赛',
        status: 'PUBLISHED', pairings: [{ ...pairing }, { ...pairing, id: 'pair-2', pairingNumber: 2 }],
      }, {
        stageId: 'stage-2', roundNumber: 2, stageCode: 'FINAL', displayName: '决赛',
        status: 'DRAFT', pairings: [{ ...pairing, id: 'pair-3' }],
      }],
    } as CupBracketView

    expect(build(bracket).map(({ topOffset, pairingGap }) => ({ topOffset, pairingGap }))).toEqual([
      { topOffset: 0, pairingGap: 16 },
      { topOffset: 74, pairingGap: 164 },
    ])
  })

  it('groups the complete cup schedule by published stage', () => {
    const group = (detailViewModel as unknown as {
      cupScheduleSections?: (matches: CompetitionMatchResponse[]) => Array<{ stageDisplayName: string; matches: CompetitionMatchResponse[] }>
    }).cupScheduleSections
    expect(group).toBeTypeOf('function')
    if (!group) return
    const match = (id: string, stageId: string, stageDisplayName: string) => ({
      id, stageId, stageDisplayName,
    }) as unknown as CompetitionMatchResponse

    expect(group([
      match('group-match', 'group-a', 'A 组'),
      match('semi-match', 'semi-final', '半决赛'),
      match('final-match', 'final', '决赛'),
    ]).map((section) => ({ name: section.stageDisplayName, count: section.matches.length }))).toEqual([
      { name: 'A 组', count: 1 },
      { name: '半决赛', count: 1 },
      { name: '决赛', count: 1 },
    ])
  })
})
