import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listSales: vi.fn() }))

vi.mock('../../services/player-auctions', () => ({
  listMyPlayerAuctionSales: mocks.listSales,
}))

type SalesPage = {
  data: Record<string, any>
  loadSales(mode: 'refresh' | 'append'): Promise<void>
  onPageScroll(event: { scrollTop: number }): void
  backToTop(): void
}

let page: SalesPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: SalesPage) => { page = definition })
  vi.stubGlobal('wx', {
    stopPullDownRefresh: vi.fn(),
    navigateTo: vi.fn(),
    pageScrollTo: vi.fn(),
  })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
})

function context() {
  const data = { ...page.data }
  return {
    data,
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
  }
}

describe('auction sales page pagination', () => {
  it('requests at most 30 sales per page and appends with the returned cursor', async () => {
    mocks.listSales
      .mockResolvedValueOnce({ items: [], nextCursor: 'next-30' })
      .mockResolvedValueOnce({ items: [], nextCursor: null })
    const instance = context()

    await page.loadSales.call(instance, 'refresh')
    await page.loadSales.call(instance, 'append')

    expect(mocks.listSales).toHaveBeenNthCalledWith(1, { keyword: undefined, cursor: undefined, limit: 30 })
    expect(mocks.listSales).toHaveBeenNthCalledWith(2, { keyword: undefined, cursor: 'next-30', limit: 30 })
  })

  it('shows the top shortcut after a long scroll and scrolls back smoothly', () => {
    const instance = context()

    page.onPageScroll.call(instance, { scrollTop: 900 })
    expect(instance.data.showBackToTop).toBe(true)
    page.backToTop.call(instance)

    expect(instance.data.showBackToTop).toBe(false)
    expect(wx.pageScrollTo).toHaveBeenCalledWith({ scrollTop: 0, duration: 250 })
  })
})
