import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listMyPlayerAuctions: vi.fn() }))
vi.mock('../../services/player-auctions', () => ({ listMyPlayerAuctions: mocks.listMyPlayerAuctions }))

type AuctionPage = {
  data: { state: 'loading' | 'loaded' | 'error'; groups: unknown[]; errorMessage: string }
  onShow(): void
  loadAuctions(showLoading?: boolean): Promise<void>
}

let page: AuctionPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: AuctionPage) => { page = definition })
  await import('./index')
})

beforeEach(() => vi.clearAllMocks())

function context() {
  return {
    data: { ...page.data, state: 'loaded' as const, groups: [{ leagueId: 'league-1' }] },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
  }
}

describe('player auctions return', () => {
  it('keeps the list visible while refreshing', () => {
    const instance = { ...context(), loadAuctions: vi.fn(async () => undefined) }

    page.onShow.call(instance)

    expect(instance.loadAuctions).toHaveBeenCalledWith(false)
    expect(instance.data.state).toBe('loaded')
  })

  it('retains the loaded list when a background refresh fails', async () => {
    mocks.listMyPlayerAuctions.mockRejectedValueOnce(new Error('offline'))
    const instance = context()

    await page.loadAuctions.call(instance, false)

    expect(instance.data.state).toBe('loaded')
    expect(instance.data.groups).toEqual([{ leagueId: 'league-1' }])
  })
})
