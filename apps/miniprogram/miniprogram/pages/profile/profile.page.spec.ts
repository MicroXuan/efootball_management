import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type ProfilePage = {
  data: { state: 'loading' | 'loaded' | 'error' }
  onShow(): void
  loadPage(showLoading?: boolean): Promise<void>
  openActionCenter(): void
  openMyMatches(): void
  openPlayerAuctions(): void
  openFavorites(): void
  startEditingName(): void
}

let page: ProfilePage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: ProfilePage) => { page = definition })
  vi.stubGlobal('wx', { navigateTo: vi.fn(), getSystemInfoSync: vi.fn(() => ({ statusBarHeight: 0 })), showToast: vi.fn() })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('profile quick actions', () => {
  it('refreshes silently when returning to an already loaded profile', () => {
    const loadPage = vi.fn(async () => undefined)

    page.onShow.call({
      data: { state: 'loaded' },
      getTabBar: () => ({ setData: vi.fn() }),
      loadPage,
    })

    expect(loadPage).toHaveBeenCalledWith(false)
  })

  it('opens the cross-league action center', () => {
    page.openActionCenter()
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/action-center/index' })
  })

  it.each([
    ['openMyMatches', '/pages/my-matches/index'],
    ['openPlayerAuctions', '/pages/player-auctions/index'],
    ['openFavorites', '/pages/favorites/index'],
  ] as const)('%s opens its existing destination', (method, url) => {
    page[method]()

    expect(wx.navigateTo).toHaveBeenCalledWith({ url })
  })

  it('opens nickname editing with the current generated name', () => {
    const setData = vi.fn()
    page.startEditingName.call({
      data: { profile: { displayName: '疾风中场' } },
      setData,
    })

    expect(setData).toHaveBeenCalledWith({ editingName: true, displayNameDraft: '疾风中场', errorMessage: '' })
  })
})
