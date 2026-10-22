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
