import { beforeAll, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listWindows: vi.fn(), workspace: vi.fn(), submit: vi.fn(), withdraw: vi.fn(), listPlayerMarket: vi.fn() }))
vi.mock('../../services/nominations', () => ({ nominationsApi: { listWindows: mocks.listWindows, workspace: mocks.workspace, submit: mocks.submit, withdraw: mocks.withdraw } }))
vi.mock('../../services/player-market', () => ({ listPlayerMarket: mocks.listPlayerMarket }))
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }))

let page: Record<string, any>
const window = { id: 'window-1', leagueId: 'league-1', seasonId: 'season-1', startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z', perTeamLimit: 2, version: 1 }
beforeAll(async () => {
  vi.stubGlobal('Page', (definition: Record<string, any>) => { page = definition })
  vi.stubGlobal('wx', { stopPullDownRefresh: vi.fn(), showToast: vi.fn() })
  await import('./index')
})
beforeEach(() => vi.clearAllMocks())
function context() {
  return { ...page, data: { ...page.data, leagueId: 'league-1', seasonId: 'season-1' }, setData(update: Record<string, unknown>) { Object.assign(this.data, update) } }
}

it('chooses the active window and loads remaining slots and own nominations', async () => {
  mocks.listWindows.mockResolvedValueOnce({ items: [window] })
  mocks.workspace.mockResolvedValueOnce({ window, leagueTeamId: 'team-1', isOpen: true, remainingSlots: 1, nominations: [{ id: 'n1', playerName: '瓦拉内' }] })
  const instance = context()
  await page.loadPage.call(instance)
  expect(mocks.workspace).toHaveBeenCalledWith('window-1')
  expect(instance.data.workspace.remainingSlots).toBe(1)
  expect(instance.data.open).toBe(true)
})

it('shows an empty state when the season has no nomination window', async () => {
  mocks.listWindows.mockResolvedValueOnce({ items: [] })
  const instance = context()
  instance.data.workspace = { window, remainingSlots: 1, nominations: [] }
  instance.data.open = true
  instance.data.players = [{ playerId: 'stale-player' }]
  await page.loadPage.call(instance)
  expect(instance.data.state).toBe('empty')
  expect(instance.data.windowId).toBe('')
  expect(instance.data.workspace).toBeNull()
  expect(instance.data.open).toBe(false)
  expect(instance.data.players).toEqual([])
  expect(mocks.workspace).not.toHaveBeenCalled()
})

it('keeps a rejected window request as a retryable error', async () => {
  mocks.listWindows.mockRejectedValueOnce(new Error('offline'))
  const instance = context()
  await page.loadPage.call(instance)
  expect(instance.data.state).toBe('error')
  expect(instance.data.errorMessage).toBe('提名信息加载失败')
})

it('loads a past window as read-only rather than empty', async () => {
  const pastWindow = { ...window, startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2020-02-01T00:00:00.000Z' }
  mocks.listWindows.mockResolvedValueOnce({ items: [pastWindow] })
  mocks.workspace.mockResolvedValueOnce({ window: pastWindow, leagueTeamId: 'team-1', isOpen: false, remainingSlots: 2, nominations: [] })
  const instance = context()
  await page.loadPage.call(instance)
  expect(instance.data.state).toBe('loaded')
  expect(instance.data.open).toBe(false)
  expect(instance.data.windowId).toBe('window-1')
})

it('only searches free players and blocks new nominations when slots run out', async () => {
  const instance = context()
  instance.data = { ...instance.data, windowId: 'window-1', workspace: { window, remainingSlots: 0, nominations: [] }, open: true, keyword: '瓦拉内' }
  mocks.listPlayerMarket.mockResolvedValueOnce({ items: [], nextCursor: null })
  await page.searchPlayers.call(instance)
  expect(mocks.listPlayerMarket).toHaveBeenCalledWith('league-1', expect.objectContaining({ seasonId: 'season-1', keyword: '瓦拉内', ownership: 'FREE' }))
  await page.nominate.call(instance, { currentTarget: { dataset: { playerId: 'player-1' } } })
  expect(mocks.submit).not.toHaveBeenCalled()
})
