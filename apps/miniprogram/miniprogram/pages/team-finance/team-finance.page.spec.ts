import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const finance = vi.hoisted(() => vi.fn())
vi.mock('../../services/economy', () => ({ economyApi: { finance } }))
let page: any
beforeAll(async () => {
  vi.stubGlobal('Page', (definition: unknown) => { page = definition })
  vi.stubGlobal('wx', { navigateTo: vi.fn() })
  await import('./index')
})
beforeEach(() => vi.clearAllMocks())

describe('team finance page', () => {
  it('opens the personal ledger for the resolved season', () => {
    const instance = { data: { teamId: 'team 1', seasonId: 'season/1' } }
    page.openPersonalLedger.call(instance)
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/personal-finance/index?teamId=team%201&seasonId=season%2F1' })
  })
  it('does not navigate without a season', () => {
    page.openPersonalLedger.call({ data: { teamId: 'team-1', seasonId: '' } })
    expect(wx.navigateTo).not.toHaveBeenCalled()
  })
})
