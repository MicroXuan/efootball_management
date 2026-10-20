import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ seasonFixtures: vi.fn(), seasons: vi.fn(), mine: vi.fn() }))
vi.mock('../../services/competitions', () => ({ competitionsApi: { seasonFixtures: mocks.seasonFixtures } }))
vi.mock('../../services/leagues', () => ({ leaguesApi: { seasons: mocks.seasons } }))
vi.mock('../../services/league-teams', () => ({ leagueTeamsApi: { mine: mocks.mine } }))
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }))
vi.mock('../competitions/competitions.viewmodel', () => ({ competitionErrorMessage: () => '加载失败' }))

type PageDefinition = Record<string, any>
let page: PageDefinition

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: PageDefinition) => { page = definition })
  vi.stubGlobal('wx', { stopPullDownRefresh: vi.fn() })
  await import('./index')
})

beforeEach(() => vi.clearAllMocks())

function context() {
  return {
    data: { ...page.data, leagueId: 'league-1', seasonId: 'season-1' },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
  }
}

describe('season fixture page state', () => {
  it('loads exact owned teams for the fourth tab and resets rows when switching teams', async () => {
    mocks.mine.mockResolvedValueOnce({ items: [
      { id: 'team-1', leagueId: 'league-1', name: '阿哈尔', teamNumber: 1, ownerAlias: '小宣', status: 'ACTIVE' },
      { id: 'team-2', leagueId: 'league-1', name: '巴塞罗那', teamNumber: 2, ownerAlias: '小新', status: 'ACTIVE' }
    ] })
    mocks.seasonFixtures.mockResolvedValue({ items: [], nextCursor: null })
    const instance = context()
    instance.data.items = [{ matchId: 'old' }]
    instance.data.nextCursor = 'old-cursor'
    await page.showMine.call(instance)
    expect(instance.data.mineTeams).toHaveLength(2)
    expect(instance.data.items).toEqual([])
    expect(mocks.seasonFixtures).toHaveBeenLastCalledWith('league-1', 'season-1', expect.objectContaining({
      scope: 'MINE', leagueTeamId: 'team-1', status: 'ALL', cursor: undefined
    }))
    page.changeMineTeam.call(instance, { detail: { value: '1' } })
    await Promise.resolve()
    expect(mocks.seasonFixtures).toHaveBeenLastCalledWith('league-1', 'season-1', expect.objectContaining({
      scope: 'MINE', leagueTeamId: 'team-2', cursor: undefined
    }))
  })

  it('explains when no team belongs to the user and keeps the original status filter', async () => {
    mocks.mine.mockResolvedValueOnce({ items: [] })
    const instance = context()
    await page.showMine.call(instance)
    expect(instance.data.fixtureScope).toBe('MINE')
    expect(instance.data.mineTeams).toEqual([])
    expect(mocks.seasonFixtures).not.toHaveBeenCalled()
    page.changeStatus.call(instance, { currentTarget: { dataset: { status: 'FINISHED' } } })
    await Promise.resolve()
    expect(instance.data.fixtureScope).toBe('ALL')
    expect(instance.data.status).toBe('FINISHED')
  })

  it('suppresses stale results after a filter reset', async () => {
    let resolveFirst!: (value: any) => void
    mocks.seasonFixtures
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ items: [], nextCursor: null })
    const instance = context()
    const first = page.load.call(instance, 'replace')
    page.changeStatus.call(instance, { currentTarget: { dataset: { status: 'FINISHED' } } })
    await Promise.resolve()
    resolveFirst({ items: [{ match: { id: 'stale' } }], nextCursor: null })
    await first
    await Promise.resolve()
    expect(instance.data.items).toEqual([])
    expect(mocks.seasonFixtures).toHaveBeenLastCalledWith('league-1', 'season-1', expect.objectContaining({ status: 'FINISHED' }))
  })

  it('keeps current items when loading another page fails', async () => {
    mocks.seasonFixtures.mockRejectedValueOnce(new Error('offline'))
    const instance = context()
    instance.data.items = [{ matchId: 'kept' }]
    instance.data.nextCursor = 'next'
    await page.loadMore.call(instance)
    expect(instance.data.items).toEqual([{ matchId: 'kept' }])
    expect(instance.data.errorMessage).toBe('加载失败')
  })
})
