import { describe, expect, it } from 'vitest'
import type { CompetitionDetail, GameAccountResponse, StandingsSnapshotResponse } from '@efm/contracts'
import { eligibleAccounts, registrationAvailability, standingsEmpty } from './detail.viewmodel'

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
})
