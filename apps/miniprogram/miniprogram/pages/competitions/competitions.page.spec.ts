import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), mine: vi.fn(), getAccessToken: vi.fn() }))

vi.mock('../../services/competitions', () => ({ competitionsApi: mocks }))
vi.mock('../../services/session', () => ({ session: { getAccessToken: mocks.getAccessToken } }))

type CompetitionsPage = {
  data: Record<string, unknown>
  load(mode: 'refresh' | 'append'): Promise<void>
}

let page: CompetitionsPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: CompetitionsPage) => { page = definition })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAccessToken.mockReturnValue('access-token')
})

describe('competition list page', () => {
  it('renders public competitions before personal registrations complete', async () => {
    let finishMine!: (value: { items: never[] }) => void
    mocks.mine.mockImplementation(() => new Promise((resolve) => { finishMine = resolve }))
    mocks.list.mockResolvedValue({ items: [{
      id: 'competition-1', name: '公开赛事', competitionType: 'ROUND_ROBIN',
      status: 'REGISTRATION_OPEN', registrationClosesAt: '2026-10-30T00:00:00.000Z',
      participantCount: 1, participantLimit: 16,
    }], nextCursor: null })
    const instance = {
      data: { ...page.data },
      setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
    }

    const loading = page.load.call(instance, 'refresh')
    await vi.waitFor(() => expect(instance.data.items).toHaveLength(1))

    expect(instance.data.loading).toBe(false)
    finishMine({ items: [] })
    await loading
  })

  it('ignores registration results from an older refresh', async () => {
    let finishFirstMine!: (value: { items: never[] }) => void
    mocks.mine.mockImplementationOnce(() => new Promise((resolve) => { finishFirstMine = resolve }))
      .mockResolvedValueOnce({ items: [] })
    mocks.list.mockResolvedValueOnce({ items: [{
      id: 'old', name: '旧赛事', status: 'REGISTRATION_OPEN',
      registrationClosesAt: '2026-10-30T00:00:00.000Z', participantCount: 1, participantLimit: 16,
    }], nextCursor: null }).mockResolvedValueOnce({ items: [{
      id: 'new', name: '新赛事', status: 'REGISTRATION_OPEN',
      registrationClosesAt: '2026-10-30T00:00:00.000Z', participantCount: 1, participantLimit: 16,
    }], nextCursor: null })
    const instance = {
      data: { ...page.data },
      setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
    }

    const first = page.load.call(instance, 'refresh')
    await vi.waitFor(() => expect(instance.data.items).toMatchObject([{ id: 'old' }]))
    await page.load.call(instance, 'refresh')
    finishFirstMine({ items: [] })
    await first

    expect(instance.data.items).toMatchObject([{ id: 'new' }])
  })
})
