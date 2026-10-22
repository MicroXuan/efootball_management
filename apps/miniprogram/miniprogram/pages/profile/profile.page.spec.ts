import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type ProfilePage = {
  data: { state: 'loading' | 'loaded' | 'error' }
  onShow(): void
  loadPage(showLoading?: boolean): Promise<void>
  openActionCenter(): void
  openMyLeagues(): void
  openPlayerAuctions(): void
  openFavorites(): void
  startEditingName(): void
}

let page: ProfilePage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: ProfilePage) => { page = definition })
  vi.stubGlobal('wx', { navigateTo: vi.fn(), switchTab: vi.fn(), getSystemInfoSync: vi.fn(() => ({ statusBarHeight: 0 })), showToast: vi.fn() })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => vi.restoreAllMocks())

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

  it('keeps the team card visible if a background refresh fails', async () => {
    const { session } = await import('../../services/session')
    const { api } = await import('../../services/api')
    const { leaguesApi } = await import('../../services/leagues')
    vi.spyOn(session, 'getAccessToken').mockReturnValue('access-token')
    vi.spyOn(api, 'request').mockRejectedValue(new Error('offline'))
    vi.spyOn(leaguesApi, 'mine').mockRejectedValue(new Error('offline'))
    const instance = {
      data: { ...page.data, state: 'loaded' as const, profile: { teams: [{ id: 'team-1' }] } },
      setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
    }

    await page.loadPage.call(instance, false)

    expect(instance.data.state).toBe('loaded')
    expect(instance.data.profile.teams).toEqual([{ id: 'team-1' }])
  })

  it('shows the profile before action-center statistics finish loading', async () => {
    const { session } = await import('../../services/session')
    const { api } = await import('../../services/api')
    const { leaguesApi } = await import('../../services/leagues')
    const actionCenter = await import('../../services/action-center')
    vi.spyOn(session, 'getAccessToken').mockReturnValue('access-token')
    vi.spyOn(api, 'request').mockResolvedValue({ id: 'user-1', displayName: 'Player' })
    vi.spyOn(leaguesApi, 'mine').mockResolvedValue({ items: [], nextCursor: null })
    let finishActionCenter!: (value: { items: never[]; actionRequiredCount: number }) => void
    vi.spyOn(actionCenter, 'loadActionCenter').mockImplementation(() => new Promise((resolve) => { finishActionCenter = resolve }))
    const instance = {
      data: { ...page.data },
      setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
    }

    const loading = page.loadPage.call(instance, true)
    await vi.waitFor(() => expect(instance.data.state).toBe('loaded'))

    expect(instance.data).toMatchObject({ profile: { displayName: 'Player' } })
    finishActionCenter({ items: [], actionRequiredCount: 0 })
    await loading
  })

  it('ignores late statistics after the profile is refreshed as logged out', async () => {
    const { session } = await import('../../services/session')
    const { api } = await import('../../services/api')
    const { leaguesApi } = await import('../../services/leagues')
    const actionCenter = await import('../../services/action-center')
    vi.spyOn(session, 'getAccessToken').mockReturnValueOnce('access-token').mockReturnValue(undefined)
    vi.spyOn(api, 'request').mockResolvedValue({ id: 'user-1', displayName: 'Player' })
    vi.spyOn(leaguesApi, 'mine').mockResolvedValue({ items: [], nextCursor: null })
    let finishActionCenter!: (value: { items: never[]; actionRequiredCount: number }) => void
    vi.spyOn(actionCenter, 'loadActionCenter').mockImplementation(() => new Promise((resolve) => { finishActionCenter = resolve }))
    const instance = {
      data: { ...page.data },
      setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
    }

    const first = page.loadPage.call(instance, true)
    await vi.waitFor(() => expect(instance.data.state).toBe('loaded'))
    await page.loadPage.call(instance, false)
    finishActionCenter({ items: [], actionRequiredCount: 3 })
    await first

    expect(instance.data).toMatchObject({ loggedIn: false, actionCenter: { actionRequiredCount: 0 } })
  })

  it('opens the cross-league action center', () => {
    page.openActionCenter()
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/action-center/index' })
  })

  it.each([
    ['openPlayerAuctions', '/pages/player-auctions/index'],
    ['openFavorites', '/pages/favorites/index'],
  ] as const)('%s opens its existing destination', (method, url) => {
    page[method]()

    expect(wx.navigateTo).toHaveBeenCalledWith({ url })
  })

  it('opens the My Leagues tab from the profile shortcut', () => {
    page.openMyLeagues()

    expect(wx.switchTab).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/leagues/index' }))
    expect(wx.navigateTo).not.toHaveBeenCalled()
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
