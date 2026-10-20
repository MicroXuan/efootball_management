import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../services/api'

const calls = vi.hoisted(() => ({
  personalFinance: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(),
}))
vi.mock('../../services/economy', () => ({ economyApi: {
  personalFinance: calls.personalFinance,
  addPersonalFinance: calls.add,
  updatePersonalFinance: calls.update,
  deletePersonalFinance: calls.remove,
} }))

type FinancePage = {
  data: Record<string, any>
  setData(update: Record<string, unknown>): void
  loadPersonal(): Promise<void>
  savePersonal(): Promise<void>
  editPersonal(event: { currentTarget: { dataset: { id: string } } }): void
  deletePersonal(event: { currentTarget: { dataset: { id: string } } }): void
}
let page: FinancePage
const entry = { id: 'entry-1', seasonId: 'season-1', direction: 'DEBIT', amountMinor: 250,
  title: '报名费', note: '第一轮', occurredOn: '2026-10-20', version: 2,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' }
const list = { leagueId: 'league-1', teamId: 'team-1', seasonId: 'season-1',
  creditTotalMinor: 0, debitTotalMinor: 250, balanceMinor: -250, items: [entry] }

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: FinancePage) => { page = definition })
  vi.stubGlobal('wx', { showToast: vi.fn(), showModal: vi.fn() })
  await import('./index')
})
beforeEach(() => { vi.clearAllMocks(); calls.personalFinance.mockResolvedValue(list) })
const context = () => Object.assign({}, page, { data: { ...page.data, teamId: 'team-1', seasonId: 'season-1' },
  setData(update: Record<string, unknown>) { Object.assign(this.data, update) } })

describe('personal finance page', () => {
  it('loads private totals and records for the selected season', async () => {
    const instance = context()
    await page.loadPersonal.call(instance)
    expect(calls.personalFinance).toHaveBeenCalledWith('team-1', 'season-1')
    expect(instance.data.personalEntries[0].amountCopy).toBe('-250')
  })

  it('explains when the personal finance endpoint is unavailable', async () => {
    const instance = context()
    calls.personalFinance.mockRejectedValueOnce(new ApiError('REQUEST_FAILED', '请求未完成', 404))
    await page.loadPersonal.call(instance)
    expect(instance.data.personalState).toBe('error')
    expect(instance.data.personalErrorMessage).toContain('接口尚未发布')
    calls.personalFinance.mockRejectedValueOnce(new ApiError('REQUEST_FAILED', 'Internal server error', 500))
    await page.loadPersonal.call(instance)
    expect(instance.data.personalErrorMessage).toContain('数据库迁移')
  })

  it('saves a new entry and edits an existing entry using its version', async () => {
    const instance = context()
    instance.data.title = '奖金'; instance.data.amount = '500'
    calls.add.mockResolvedValue(entry)
    await page.savePersonal.call(instance)
    expect(calls.add).toHaveBeenCalledWith('team-1', expect.objectContaining({ title: '奖金', amountMinor: 500 }))
    instance.data.personal = list
    page.editPersonal.call(instance, { currentTarget: { dataset: { id: 'entry-1' } } })
    expect(instance.data.editingVersion).toBe(2)
    calls.update.mockResolvedValue(entry)
    await page.savePersonal.call(instance)
    expect(calls.update).toHaveBeenCalledWith('team-1', 'entry-1', expect.objectContaining({ expectedVersion: 2 }))
  })

  it('rejects invalid money before sending a request', async () => {
    const instance = context()
    instance.data.title = '费用'; instance.data.amount = '1.5'
    await page.savePersonal.call(instance)
    expect(calls.add).not.toHaveBeenCalled()
  })
})
