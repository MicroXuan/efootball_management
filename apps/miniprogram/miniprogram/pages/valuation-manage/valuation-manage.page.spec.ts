import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { workspace, mine } = vi.hoisted(() => ({ workspace: vi.fn(), mine: vi.fn() }))
vi.mock('../../services/valuations', () => ({ valuationsApi: { workspace } }))
vi.mock('../../services/league-teams', () => ({ leagueTeamsApi: { mine } }))

let page: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (definition: Record<string, any>) => { page = definition })
  await import('./index')
})
beforeEach(() => vi.clearAllMocks())

const valuationWorkspace = {
  team: { id: 'team-1', name: '阿哈尔' },
  window: { id: 'window-1', name: 'S1', state: 'OPEN', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-31T00:00:00.000Z', rule: { id: 'rule-1', version: 1, minimumValueMinor: 0, maximumValueMinor: 100000, maximumIncreaseBps: 2000, maximumDecreaseBps: 2000 } },
  submission: null,
  players: [],
}

function context() {
  return {
    data: { teamId: 'team-1' },
    setData(data: Record<string, unknown>) { Object.assign(this.data, data) },
  }
}

describe('valuation team crest', () => {
  it('uses the current team logo from the existing my-teams endpoint', async () => {
    workspace.mockResolvedValue(valuationWorkspace)
    mine.mockResolvedValue({ items: [{ id: 'team-1', shortName: '阿哈尔', logoUrl: 'https://example.com/ahal.png' }] })
    const instance = context()

    await page.loadPage.call(instance)

    expect(instance.data).toMatchObject({ state: 'loaded', teamLogoUrl: 'https://example.com/ahal.png', teamBadgeFallback: '阿' })
  })

  it('keeps the valuation page available when the optional logo lookup fails', async () => {
    workspace.mockResolvedValue(valuationWorkspace)
    mine.mockRejectedValue(new Error('unavailable'))
    const instance = context()

    await page.loadPage.call(instance)

    expect(instance.data).toMatchObject({ state: 'loaded', teamLogoUrl: '', teamBadgeFallback: '阿' })
  })
})
