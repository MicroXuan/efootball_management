import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
})
