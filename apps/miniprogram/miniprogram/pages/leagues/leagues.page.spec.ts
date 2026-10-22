import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestMyLeaguesTab } from './league-list-navigation'

const mocks = vi.hoisted(() => ({
  listLeagues: vi.fn(),
  listMyLeagues: vi.fn(),
  getPresentation: vi.fn(),
  getAccessToken: vi.fn(),
  cacheImageSource: vi.fn(),
}))

vi.mock('../../services/leagues', () => ({
  leaguesApi: { list: mocks.listLeagues, mine: mocks.listMyLeagues },
}))
vi.mock('../../services/platform-presentation', () => ({
  platformPresentationApi: { get: mocks.getPresentation },
}))
vi.mock('../../services/session', () => ({
  session: { getAccessToken: mocks.getAccessToken },
}))
vi.mock('../../services/image-source', () => ({ cacheImageSource: mocks.cacheImageSource }))
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }))

type LeaguesPage = {
  data: Record<string, unknown>
  onShow(): void
  loadLeagues(showLoading?: boolean): Promise<void>
  switchTab(event: { currentTarget: { dataset: { tab: 'all' | 'mine' } } }): void
}

let page: LeaguesPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: LeaguesPage) => { page = definition })
  vi.stubGlobal('wx', {
    downloadFile: vi.fn(),
    cloud: { downloadFile: vi.fn() },
  })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAccessToken.mockReturnValue(null)
  mocks.listLeagues.mockResolvedValue({ items: [], nextCursor: null })
  mocks.getPresentation.mockResolvedValue({
    leagueCenterBannerUrl: 'https://media.example/banner.webp',
    leagueCenterBannerCloudFileId: 'cloud://staging/banner.webp',
    version: 3,
  })
  mocks.cacheImageSource.mockResolvedValue('wxfile://tmp/banner.webp')
})

function context() {
  return {
    data: { ...page.data },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
  }
}

describe('league banner presentation', () => {
  it('shows public leagues before the private leagues request completes', async () => {
    mocks.getAccessToken.mockReturnValue('access-token')
    let finishMine!: (value: { items: never[]; nextCursor: null }) => void
    mocks.listMyLeagues.mockImplementation(() => new Promise((resolve) => { finishMine = resolve }))
    mocks.listLeagues.mockResolvedValue({ items: [{ id: 'league-1', name: 'Test League', shortName: 'Test', description: '', logoUrl: null, edition: 'NATIONAL', currentSeason: null }], nextCursor: null })
    const instance = context()

    const loading = page.loadLeagues.call(instance, true)
    await vi.waitFor(() => expect(instance.data.state).toBe('loaded'))

    expect(instance.data.allLeagues).toHaveLength(1)
    page.switchTab.call(instance, { currentTarget: { dataset: { tab: 'mine' } } })
    expect(instance.data.state).toBe('loading')
    finishMine({ items: [], nextCursor: null })
    await loading
    expect(instance.data.state).toBe('loaded')
  })

  it('does not mistake a failed private request for no bound leagues', async () => {
    mocks.getAccessToken.mockReturnValue('access-token')
    mocks.listMyLeagues.mockRejectedValue(new Error('offline'))
    const instance = context()

    await page.loadLeagues.call(instance, true)
    expect(instance.data.state).toBe('loaded')

    page.switchTab.call(instance, { currentTarget: { dataset: { tab: 'mine' } } })
    expect(instance.data.state).toBe('error')
  })

  it('uses the HTTPS banner URL after the cloud file has been preloaded', async () => {
    const instance = context()

    await page.loadLeagues.call(instance, false)

    expect(instance.data.bannerDisplayUrl).toBe('https://media.example/banner.webp')
    expect(instance.data.bannerMode).toBe('image')
  })

  it('renders the league list before a slow banner preload finishes', async () => {
    let finishBanner!: (value: string) => void
    mocks.cacheImageSource.mockImplementation(() => new Promise<string>((resolve) => { finishBanner = resolve }))
    const instance = context()

    const loading = page.loadLeagues.call(instance, false)
    await Promise.resolve()
    await Promise.resolve()

    expect(instance.data.state).toBe('loaded')
    await vi.waitFor(() => expect(mocks.cacheImageSource).toHaveBeenCalled())
    finishBanner('wxfile://tmp/banner.webp')
    await loading
  })
})

describe('My Leagues shortcut', () => {
  it('selects My Leagues for one tab visit without changing later visits', () => {
    const instance = {
      ...context(),
      getTabBar: () => ({ setData: vi.fn() }),
      loadLeagues: vi.fn(async () => undefined),
    }

    requestMyLeaguesTab()
    page.onShow.call(instance)
    expect(instance.data.activeTab).toBe('mine')

    instance.data.activeTab = 'all'
    page.onShow.call(instance)
    expect(instance.data.activeTab).toBe('all')
  })

  it('keeps the current list visible while refreshing on return', () => {
    const instance = {
      ...context(),
      data: { ...page.data, state: 'loaded', activeTab: 'all', allLeagues: [{ id: 'league-1' }], myLeagues: [{ id: 'league-2' }], leagues: [{ id: 'league-1' }] },
      getTabBar: () => ({ setData: vi.fn() }),
      loadLeagues: vi.fn(async () => undefined),
    }

    requestMyLeaguesTab()
    page.onShow.call(instance)

    expect(instance.loadLeagues).toHaveBeenCalledWith(false)
    expect(instance.data.leagues).toEqual([{ id: 'league-2' }])
    expect(instance.data.state).toBe('loaded')
  })
})
