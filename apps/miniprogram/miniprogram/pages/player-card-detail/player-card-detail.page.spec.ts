import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getPlayerCard: vi.fn() }))

vi.mock('../../services/catalog', () => ({ catalogApi: { getPlayerCard: mocks.getPlayerCard } }))
vi.mock('../../services/favorites', () => ({ favoritesApi: { statuses: vi.fn() } }))
vi.mock('../../services/session', () => ({ session: { getAccessToken: () => 'token' } }))

type DetailPage = {
  data: { state: string; cardId: string; errorMessage: string }
  onLoad(options: { id?: string }): void
  onShow(): void
  onUnload(): void
  loadCard(): Promise<void>
  resumeAuthenticatedDetail(): void
  setData(update: Record<string, unknown>): void
  [key: string]: unknown
}

const cardId = '11111111-1111-4111-8111-111111111111'
let page: DetailPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: DetailPage) => { page = definition })
  await import('./index')
})

beforeEach(() => vi.clearAllMocks())

function instance(): DetailPage {
  return {
    ...page,
    data: { ...page.data },
    setData(update) { Object.assign(this.data, update) },
  }
}

describe('player card detail page lifecycle', () => {
  it('starts a new card request each time the detail page is reopened', async () => {
    mocks.getPlayerCard.mockRejectedValue(new Error('offline'))
    const first = instance()
    first.onLoad({ id: cardId })
    await Promise.resolve()
    first.onUnload()

    const second = instance()
    second.onLoad({ id: cardId })
    await Promise.resolve()

    expect(mocks.getPlayerCard).toHaveBeenCalledTimes(2)
    expect(second.data.state).toBe('error')
  })

  it('does not duplicate the request when onShow follows onLoad', () => {
    mocks.getPlayerCard.mockReturnValue(new Promise(() => undefined))
    const detail = instance()

    detail.onLoad({ id: cardId })
    detail.onShow()

    expect(mocks.getPlayerCard).toHaveBeenCalledTimes(1)
  })

  it('ignores a response from a page that has already been closed', async () => {
    let rejectOld!: (reason: Error) => void
    const oldRequest = new Promise((_resolve, reject) => { rejectOld = reject })
    void oldRequest.catch(() => undefined)
    mocks.getPlayerCard
      .mockReturnValueOnce(oldRequest)
      .mockRejectedValueOnce(new Error('offline'))
    const first = instance()
    first.onLoad({ id: cardId })
    first.onUnload()
    const second = instance()
    second.onLoad({ id: cardId })
    rejectOld(new Error('late failure'))
    await Promise.resolve()

    expect(first.data.state).toBe('loading')
    expect(second.data.state).toBe('error')
    expect(second.data.errorMessage).toContain('详情加载失败')
  })
})
