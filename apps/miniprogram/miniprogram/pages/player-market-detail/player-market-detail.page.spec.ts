import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ submit: vi.fn(), amend: vi.fn(), withdraw: vi.fn() }))
vi.mock('../../services/player-market', () => ({
  amendPlayerApplication: mocks.amend,
  createPlayerMarketMutationKey: () => 'key-1',
  getPlayerMarketDetail: vi.fn(),
  submitPlayerApplication: mocks.submit,
  withdrawPlayerApplication: mocks.withdraw,
}))
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }))

type DetailPage = {
  data: Record<string, any>
  detail: any
  submitApplication(): Promise<void>
  withdrawApplication(): Promise<void>
}
let page: DetailPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: DetailPage) => { page = definition })
  vi.stubGlobal('wx', { showToast: vi.fn() })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.submit.mockResolvedValue({ id: 'app-1' })
  mocks.withdraw.mockResolvedValue({ id: 'app-1' })
})

function context() {
  return {
    data: { ...page.data, leagueId: 'league-1', seasonId: 'season-1', teamId: 'team-1', amount: '700', submitting: false } as Record<string, any>,
    detail: {
      playerId: 'player-1', playerName: '球员甲', playerEnglishName: 'Player', action: 'FORCE_SIGN',
      activeTransferWindowId: null, activeForcedOfferWindowId: 'forced-1',
      currentOwner: { teamId: 'team-2', teamNumber: 2, name: '对手队', logoUrl: null, ownerAlias: '对手' }, ownershipId: 'own-1', ownershipVersion: 3,
      card: { playerCardId: 'card-1' }, officialValueMinor: 500, myApplication: null,
    } as Record<string, any>,
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
    loadDetail: vi.fn(async () => undefined),
    handleMutationError: vi.fn(async () => undefined),
  }
}

describe('player market detail page', () => {
  it('submits a forced offer using the forced-period ID while transfer is closed', async () => {
    const instance = context()
    await page.submitApplication.call(instance)
    expect(mocks.submit).toHaveBeenCalledWith('league-1', expect.objectContaining({
      window: { kind: 'FORCED_OFFER', id: 'forced-1' }, type: 'FORCED_TRANSFER',
    }), 'key-1')
  })

  it('does not send a forced bid without its period', async () => {
    const instance = context()
    instance.detail.activeForcedOfferWindowId = null
    await page.submitApplication.call(instance)
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(instance.data.errorMessage).toContain('强报期')
  })
})
