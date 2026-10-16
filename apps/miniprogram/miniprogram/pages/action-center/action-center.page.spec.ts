import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionCenterItem } from '@efm/contracts'

const mocks = vi.hoisted(() => ({
  loadActionCenter: vi.fn(),
  markActionCenterRead: vi.fn(),
  readActionCenterVersions: vi.fn(() => ({})),
}))

vi.mock('../../services/action-center', () => ({
  loadActionCenter: mocks.loadActionCenter,
  markActionCenterRead: mocks.markActionCenterRead,
  readActionCenterVersions: mocks.readActionCenterVersions,
  actionCenterAttentionCount: vi.fn(() => 0),
}))
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }))

type ActionCenterPage = {
  data: Record<string, any>
  onLoad(options: { leagueId?: string }): void
  load(showLoading?: boolean): Promise<void>
}

let page: ActionCenterPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: ActionCenterPage) => { page = definition })
  vi.stubGlobal('wx', { stopPullDownRefresh: vi.fn(), navigateTo: vi.fn() })
  await import('./index')
})

beforeEach(() => vi.clearAllMocks())

function item(id: string, leagueId: string): ActionCenterItem {
  return {
    id,
    version: '2026-10-15T12:00:00.000Z',
    source: 'MATCH_RESULT',
    section: 'STATUS_UPDATE',
    league: { id: leagueId, name: leagueId },
    seasonId: 'season-1',
    teamId: 'team-1',
    title: id,
    detail: id,
    statusLabel: '审核中',
    occurredAt: '2026-10-15T12:00:00.000Z',
    route: `/pages/match-result/index?id=${id}`,
  }
}

function context() {
  return {
    data: { ...page.data },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
  }
}

describe('action center page', () => {
  it('marks only the visible league items as read', async () => {
    const leagueItem = item('league-1-item', 'league-1')
    const otherItem = item('league-2-item', 'league-2')
    mocks.loadActionCenter.mockResolvedValue({ items: [leagueItem, otherItem], actionRequiredCount: 0 })
    const instance = context()
    page.onLoad.call(instance, { leagueId: 'league-1' })

    await page.load.call(instance)

    expect(mocks.markActionCenterRead).toHaveBeenCalledWith([leagueItem])
  })
})
