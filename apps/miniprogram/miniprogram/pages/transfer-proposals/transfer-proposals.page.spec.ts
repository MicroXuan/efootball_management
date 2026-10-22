import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mine: vi.fn(), listTransfers: vi.fn() }))
vi.mock('../../services/league-teams', () => ({ leagueTeamsApi: { mine: mocks.mine } }))
vi.mock('../../services/player-requests', () => ({ playerRequestsApi: { listTransfers: mocks.listTransfers } }))
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }))

type TransferPage = {
  data: { state: 'loading' | 'loaded' | 'error'; seasonId: string; items: unknown[]; errorMessage: string }
  onShow(): void
  load(showLoading?: boolean): Promise<void>
}

let page: TransferPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: TransferPage) => { page = definition })
  await import('./index')
})

beforeEach(() => vi.clearAllMocks())

function context() {
  return {
    data: { ...page.data, state: 'loaded' as const, seasonId: 'season-1', items: [{ id: 'proposal-1' }] },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
  }
}

describe('transfer proposals return', () => {
  it('keeps proposals visible while refreshing', () => {
    const instance = { ...context(), load: vi.fn(async () => undefined) }

    page.onShow.call(instance)

    expect(instance.load).toHaveBeenCalledWith(false)
    expect(instance.data.state).toBe('loaded')
  })

  it('retains proposals when a background refresh fails', async () => {
    mocks.mine.mockRejectedValueOnce(new Error('offline'))
    mocks.listTransfers.mockResolvedValueOnce({ items: [] })
    const instance = context()

    await page.load.call(instance, false)

    expect(instance.data.state).toBe('loaded')
    expect(instance.data.items).toEqual([{ id: 'proposal-1' }])
  })
})
