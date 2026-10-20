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

it('only searches free players and blocks new nominations when slots run out', async () => {
  const instance = context()
  instance.data = { ...instance.data, windowId: 'window-1', workspace: { window, remainingSlots: 0, nominations: [] }, open: true, keyword: '瓦拉内' }
  mocks.listPlayerMarket.mockResolvedValueOnce({ items: [], nextCursor: null })
  await page.searchPlayers.call(instance)
  expect(mocks.listPlayerMarket).toHaveBeenCalledWith('league-1', expect.objectContaining({ seasonId: 'season-1', keyword: '瓦拉内', ownership: 'FREE' }))
  await page.nominate.call(instance, { currentTarget: { dataset: { playerId: 'player-1' } } })
  expect(mocks.submit).not.toHaveBeenCalled()
})
