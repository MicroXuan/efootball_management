import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompetitionDetail } from '@efm/contracts'

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  managerDetail: vi.fn(),
  matches: vi.fn(),
  standings: vi.fn(),
  bracket: vi.fn(),
  cupParticipants: vi.fn(),
  cupRegistration: vi.fn(),
  seasonEntry: vi.fn(),
}))

vi.mock('../../services/competitions', () => ({ competitionsApi: mocks }))
vi.mock('../../services/session', () => ({ session: { getAccessToken: () => 'player-token' } }))
vi.mock('../../services/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { request: vi.fn() },
}))

type DetailPage = {
  data: Record<string, unknown>
  load(): Promise<void>
  openMyMatches(): void
  openBracketPanorama(): void
  selectScheduleStage(event: { currentTarget: { dataset: { id?: string } } }): void
}

let page: DetailPage

const cup = {
  id: 'cup-1',
  seasonId: 'season-1',
  competitionType: 'GROUP_KNOCKOUT_CUP',
  name: '足总杯',
  description: '',
  platform: 'MOBILE',
  serverRegion: 'GLOBAL',
  participantType: 'SEASON_TEAM',
  format: 'GROUP_KNOCKOUT',
  status: 'REGISTRATION_OPEN',
  registrationOpensAt: '2026-10-12T00:00:00.000Z',
  registrationClosesAt: '2026-10-14T00:00:00.000Z',
  startsAt: '2026-10-15T00:00:00.000Z',
  endsAt: '2026-10-30T00:00:00.000Z',
  participantLimit: 16,
  participantCount: 0,
  version: 2,
  activeRuleVersion: 1,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
  currentRegistration: null,
  rules: { winPoints: 3, drawPoints: 1, lossPoints: 0, tieBreakers: [] },
  schedule: { published: false, matchCount: 0, roundCount: 0 },
  capabilities: {
    canRegister: true,
    canWithdraw: false,
    canManage: false,
    canReviewRegistrations: false,
    canManageSchedule: false,
    canManageResults: false,
  },
} as unknown as CompetitionDetail

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: DetailPage) => { page = definition })
  vi.stubGlobal('wx', { stopPullDownRefresh: vi.fn(), navigateTo: vi.fn(), pageScrollTo: vi.fn() })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.detail.mockResolvedValue(cup)
  mocks.matches.mockResolvedValue([])
  mocks.standings.mockResolvedValue({ competitionId: cup.id, version: 0, rows: [] })
  mocks.bracket.mockResolvedValue(null)
  mocks.cupParticipants.mockResolvedValue([])
  mocks.cupRegistration.mockResolvedValue(null)
  mocks.seasonEntry.mockResolvedValue(null)
})

function context() {
  const data: Record<string, unknown> = { ...page.data, id: cup.id }
  return {
    data,
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
  }
}

describe('competition detail page loading', () => {
  it('uses only player-facing endpoints and skips an unavailable bracket during cup registration', async () => {
    const instance = context()

    await page.load.call(instance)

    expect(mocks.managerDetail).not.toHaveBeenCalled()
    expect(mocks.bracket).not.toHaveBeenCalled()
    expect(instance.data.detail).toEqual(cup)
  })

  it('opens the current cup schedule without leaving the competition', () => {
    const instance = context()
    instance.data.isCup = true
    instance.data.activeTab = 'overview'

    page.openMyMatches.call(instance)

    expect(instance.data.activeTab).toBe('schedule')
    expect(wx.navigateTo).not.toHaveBeenCalled()
  })

  it('opens the full-screen bracket for the current cup', () => {
    const instance = context()

    page.openBracketPanorama.call(instance)

    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: '/pages/cup-bracket-panorama/index?id=cup-1',
    })
  })

  it('selects one cup stage at a time for the mobile matchday board', async () => {
    const instance = context()
    mocks.matches.mockResolvedValue([
      { id: 'match-a', stageId: 'stage-a', stageCode: 'GROUP_A', stageDisplayName: 'A 组', roundNumber: 1, matchNumber: 1 },
      { id: 'match-b', stageId: 'stage-b', stageCode: 'GROUP_B', stageDisplayName: 'B 组', roundNumber: 1, matchNumber: 1 },
    ])

    await page.load.call(instance)

    expect(instance.data.selectedStageId).toBe('stage-a')
    expect(instance.data.activeCupSchedule).toMatchObject({ stageId: 'stage-a', stageDisplayName: 'A 组' })

    page.selectScheduleStage.call(instance, { currentTarget: { dataset: { id: 'stage-b' } } })

    expect(instance.data.selectedStageId).toBe('stage-b')
    expect(instance.data.activeCupSchedule).toMatchObject({ stageId: 'stage-b', stageDisplayName: 'B 组' })
  })
})
