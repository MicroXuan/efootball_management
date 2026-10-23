import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ searchPlayers: vi.fn(), listCardPackOptions: vi.fn() }))

vi.mock('../../services/catalog', () => ({ catalogApi: mocks }))

type PlayersPage = {
  data: { loading: boolean; cards: unknown[]; errorMessage: string }
  onLoad(): void
  onShow(): void
  setData(update: Record<string, unknown>): void
  getTabBar?(): { setData(update: Record<string, unknown>): void }
}

let page: PlayersPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: PlayersPage) => { page = definition })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchPlayers.mockResolvedValue({ items: [], nextCursor: null, releaseSequence: 1 })
  mocks.listCardPackOptions.mockResolvedValue({ items: [], releaseSequence: 1 })
})

describe('player catalog page', () => {
  it('loads published cards and packs on entry without a session', async () => {
    const instance: PlayersPage = {
      ...page,
      data: { ...page.data },
      setData(update) { Object.assign(this.data, update) },
    }

    instance.onLoad()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.searchPlayers).toHaveBeenCalledOnce()
    expect(mocks.listCardPackOptions).toHaveBeenCalledOnce()
    expect(instance.data.loading).toBe(false)
    expect(instance.data.errorMessage).toBe('')
  })
})
