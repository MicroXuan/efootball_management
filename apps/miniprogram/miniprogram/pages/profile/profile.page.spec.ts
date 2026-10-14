import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type ProfilePage = {
  openMyMatches(): void
  openPlayerAuctions(): void
  openFavorites(): void
}

let page: ProfilePage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: ProfilePage) => { page = definition })
  vi.stubGlobal('wx', { navigateTo: vi.fn(), getSystemInfoSync: vi.fn(() => ({ statusBarHeight: 0 })) })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('profile quick actions', () => {
  it.each([
    ['openMyMatches', '/pages/my-matches/index'],
    ['openPlayerAuctions', '/pages/player-auctions/index'],
    ['openFavorites', '/pages/favorites/index'],
  ] as const)('%s opens its existing destination', (method, url) => {
    page[method]()

    expect(wx.navigateTo).toHaveBeenCalledWith({ url })
  })
})
