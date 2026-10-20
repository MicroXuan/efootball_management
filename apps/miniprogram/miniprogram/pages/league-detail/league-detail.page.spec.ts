import { beforeAll, beforeEach, expect, it, vi } from 'vitest'

let page: Record<string, any>
const navigateTo = vi.fn()
const showToast = vi.fn()

beforeAll(async () => {
  vi.stubGlobal('wx', { getSystemInfoSync: () => ({ statusBarHeight: 30 }), navigateTo, showToast })
  vi.stubGlobal('Page', (definition: Record<string, any>) => { page = definition })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
})

function context() {
  return {
    ...page,
    data: { ...page.data, leagueId: 'league-1', selectedSeason: { id: 'season-1' }, playerAuctionEnabled: true,
      workspace: { leagueId: 'league-1', seasonId: 'season-1', team: { leagueTeamId: 'team-1', name: '海港' },
        capabilities: { canViewStandings: true, canViewAssets: true, canViewFinance: true, canManageValuations: false } } },
  }
}

it('opens both fixtures and calendar in one tap', () => {
  const instance = context()
  page.openFixtures.call(instance)
  page.openSeasonCalendar.call(instance)
  expect(navigateTo).toHaveBeenNthCalledWith(1, { url: '/pages/my-matches/index?leagueId=league-1&seasonId=season-1' })
  expect(navigateTo).toHaveBeenNthCalledWith(2, { url: '/pages/season-calendar/index?leagueId=league-1&seasonId=season-1' })
})

it('opens nomination and auction cards but keeps auction owner-gated', () => {
  const instance = context()
  page.onWorkspaceModuleTap.call(instance, { currentTarget: { dataset: { key: 'nominations' } } })
  page.onWorkspaceModuleTap.call(instance, { currentTarget: { dataset: { key: 'playerAuctions' } } })
  expect(navigateTo).toHaveBeenNthCalledWith(1, { url: '/pages/player-nominations/index?leagueId=league-1&seasonId=season-1' })
  expect(navigateTo).toHaveBeenNthCalledWith(2, { url: '/pages/player-auctions/index' })

  navigateTo.mockClear()
  instance.data.playerAuctionEnabled = false
  page.onWorkspaceModuleTap.call(instance, { currentTarget: { dataset: { key: 'playerAuctions' } } })
  expect(navigateTo).not.toHaveBeenCalled()
})
