import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listMarket: vi.fn(),
  listApplications: vi.fn(),
  listAnnouncements: vi.fn(),
}))

vi.mock('../../services/player-market', () => ({
  listPlayerMarket: mocks.listMarket,
  listPlayerApplications: mocks.listApplications,
  listPlayerMarketAnnouncements: mocks.listAnnouncements,
}))
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }))

type MarketPage = {
  data: Record<string, any>
  loadView(showLoading?: boolean, mode?: 'replace' | 'append'): Promise<void>
  onPageScroll(event: { scrollTop: number }): void
  backToTop(): void
}

let page: MarketPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: MarketPage) => { page = definition })
  vi.stubGlobal('wx', {
    stopPullDownRefresh: vi.fn(),
    navigateTo: vi.fn(),
    pageScrollTo: vi.fn(),
  })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listApplications.mockResolvedValue({ items: [], nextCursor: null })
  mocks.listAnnouncements.mockResolvedValue({ items: [], nextCursor: null })
})

function player(playerId: string) {
  return {
    playerId, playerName: playerId, nationality: null, club: null, currentOwner: null,
    ownershipId: null, ownershipVersion: null, officialValueMinor: null, valuationVersion: null,
    card: null, forcedTransferBadge: false, action: 'APPLY', disabledReason: null,
  }
}

function context() {
  const data: Record<string, any> = {
    ...page.data,
    leagueId: 'league-1', seasonId: 'season-1', teamId: 'team-1', view: 'players',
  }
  return {
    data,
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
  }
}

describe('player market page pagination', () => {
  it('loads 30 players initially, then appends the next cursor page without duplicates', async () => {
    mocks.listMarket
      .mockResolvedValueOnce({ items: [player('player-1'), player('player-2')], nextCursor: 'next-1' })
      .mockResolvedValueOnce({ items: [player('player-2'), player('player-3')], nextCursor: null })
    const instance = context()

    await page.loadView.call(instance)
    await page.loadView.call(instance, false, 'append')

    expect(mocks.listMarket).toHaveBeenNthCalledWith(1, 'league-1', expect.objectContaining({ limit: 30, cursor: undefined }))
    expect(mocks.listMarket).toHaveBeenNthCalledWith(2, 'league-1', expect.objectContaining({ limit: 30, cursor: 'next-1' }))
    expect(instance.data.players.map(({ playerId }: { playerId: string }) => playerId)).toEqual(['player-1', 'player-2', 'player-3'])
    expect(instance.data.nextPlayerCursor).toBeNull()
  })

  it('shows a floating shortcut after scrolling and returns to the page top', () => {
    const instance = context()

    page.onPageScroll.call(instance, { scrollTop: 900 })
    expect(instance.data.showBackToTop).toBe(true)
    page.backToTop.call(instance)

    expect(instance.data.showBackToTop).toBe(false)
    expect(wx.pageScrollTo).toHaveBeenCalledWith({ scrollTop: 0, duration: 250 })
  })
})
