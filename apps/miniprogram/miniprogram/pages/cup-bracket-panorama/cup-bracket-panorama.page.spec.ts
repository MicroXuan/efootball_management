import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompetitionDetail, CupBracketView } from '@efm/contracts'

const mocks = vi.hoisted(() => ({ detail: vi.fn(), bracket: vi.fn(), cupParticipants: vi.fn() }))
vi.mock('../../services/competitions', () => ({ competitionsApi: mocks }))

type PanoramaPage = {
  data: Record<string, unknown>
  onLoad(options: Record<string, string | undefined>): void
  load(): Promise<void>
  zoomIn(): void
  zoomOut(): void
  resetViewport(): void
  trackScale(event: { detail: { scale: number } }): void
}

let page: PanoramaPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: PanoramaPage) => { page = definition })
  vi.stubGlobal('wx', { setNavigationBarTitle: vi.fn() })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.detail.mockResolvedValue({ id: 'cup-1', name: '足总杯' } as CompetitionDetail)
  mocks.cupParticipants.mockResolvedValue([])
  mocks.bracket.mockResolvedValue({
    competitionId: 'cup-1', proposalId: 'proposal-1', proposalVersion: 1,
    proposalStatus: 'CONFIRMED', bracketSize: 2, currentRoundNumber: 1,
    rounds: [{ stageId: 'final', roundNumber: 1, stageCode: 'FINAL', displayName: '决赛', status: 'PUBLISHED', pairings: [{
      id: 'pair-1', pairingNumber: 1, homeParticipant: null, awayParticipant: null,
      winnerParticipant: null, isBye: false, match: null,
    }] }],
  } as CupBracketView)
})

function context() {
  const data: Record<string, unknown> = { ...page.data }
  return { data, setData(update: Record<string, unknown>) { Object.assign(this.data, update) } }
}

describe('cup bracket panorama page', () => {
  it('loads the cup, bracket, and participant artwork for a direct link', async () => {
    const instance = context()
    instance.data.id = 'cup-1'

    await page.load.call(instance)

    expect(mocks.detail).toHaveBeenCalledWith('cup-1')
    expect(mocks.bracket).toHaveBeenCalledWith('cup-1')
    expect(mocks.cupParticipants).toHaveBeenCalledWith('cup-1')
    expect(instance.data.competitionName).toBe('足总杯')
    expect(instance.data.rounds).toHaveLength(1)
    expect(instance.data.loading).toBe(false)
  })

  it('offers bounded zoom controls and a readable reset scale', () => {
    const instance = context()
    instance.data.scale = 1

    page.zoomIn.call(instance)
    expect(instance.data.scale).toBe(1.2)
    instance.data.scale = 1.6
    page.zoomIn.call(instance)
    expect(instance.data.scale).toBe(1.6)
    instance.data.scale = 0.6
    page.zoomOut.call(instance)
    expect(instance.data.scale).toBe(0.6)
    page.resetViewport.call(instance)
    expect(instance.data.scale).toBe(0.8)

    page.trackScale.call(instance, { detail: { scale: 1.35 } })
    expect(instance.data.scale).toBe(1.35)
  })
})
