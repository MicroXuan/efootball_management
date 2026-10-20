import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  submitDisappearance: vi.fn(),
  submitTransfer: vi.fn(),
  transferCandidate: vi.fn(),
}))

vi.mock('../../services/player-requests', () => ({
  playerRequestsApi: {
    submitDisappearance: mocks.submitDisappearance,
    submitTransfer: mocks.submitTransfer,
    transferCandidate: mocks.transferCandidate,
  },
}))

type AssetsPage = {
  data: Record<string, any>
  confirmDisappearance(event: unknown): void
  submitDisappearance(ownershipId: string, version: number): Promise<void>
  openTransfer(event: unknown): Promise<void>
  submitTransfer(): Promise<void>
  openTeamDirectory(): void
  loadPage(showLoading?: boolean): Promise<void>
}

let page: AssetsPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: AssetsPage) => { page = definition })
  vi.stubGlobal('wx', { showModal: vi.fn(), showToast: vi.fn(), navigateTo: vi.fn() })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
})

function context(assets: Record<string, unknown> | null) {
  const instance = Object.assign({}, page, {
    data: { ...page.data, teamId: 'owner-team', assets },
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
    loadPage: vi.fn().mockResolvedValue(undefined),
  })
  return instance
}

describe('team assets request actions', () => {
  it('opens the directory for the viewed league and ignores unloaded assets', () => {
    const instance = context({ leagueId: 'league/a', isOwner: true })
    page.openTeamDirectory.call(instance)
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/league-team-directory/index?leagueId=league%2Fa' })

    vi.mocked(wx.navigateTo).mockClear()
    instance.data.assets = null
    page.openTeamDirectory.call(instance)
    expect(wx.navigateTo).not.toHaveBeenCalled()
  })

  it('opens a reason-free disappearance confirmation and submits a system reason', async () => {
    const instance = context({
      seasonId: 'season-1',
      active: [{ ownershipId: 'ownership-1', ownershipVersion: 3, playerName: '球员甲', disappearanceEnabled: true }],
    })
    page.confirmDisappearance.call(instance, { currentTarget: { dataset: { ownershipId: 'ownership-1', playerName: '球员甲' } } })

    expect(instance.data.disappearanceDraft).toEqual({ ownershipId: 'ownership-1', expectedOwnershipVersion: 3, playerName: '球员甲' })
    expect(wx.showModal).not.toHaveBeenCalled()

    mocks.submitDisappearance.mockResolvedValue({})
    await page.submitDisappearance.call(instance, 'ownership-1', 3)
    expect(mocks.submitDisappearance).toHaveBeenCalledWith('owner-team', 'ownership-1',
      expect.objectContaining({ seasonId: 'season-1', expectedOwnershipVersion: 3, reason: '球队申请标记消失' }), expect.any(String))
    expect(instance.data.disappearanceDraft).toBeNull()
  })

  it('only prepares a buyer transfer without locking owner actions', async () => {
    const instance = context({
      isOwner: false, leagueId: 'league-1', teamId: 'seller-team', seasonId: 'season-1',
      viewerTeamId: 'buyer-team', viewerTeamName: '阿哈尔', viewerTeamNumber: 1,
    })
    mocks.transferCandidate.mockResolvedValue({ eligible: true, sourceTeamId: 'seller-team', ownershipId: 'ownership-1', ownershipVersion: 3 })

    await page.openTransfer.call(instance, { currentTarget: { dataset: { playerId: 'player-1', playerName: '球员甲' } } })

    expect(mocks.transferCandidate).toHaveBeenCalledWith('league-1', 'season-1', 'player-1')
    expect(instance.data.transferTargets).toEqual([{ teamId: 'buyer-team', teamName: '1号 阿哈尔', teamNumber: 1 }])
    expect(instance.data.transferCandidate).toBeTruthy()
    expect(instance.data.submittingRequest).toBe(false)
    expect(instance.data.transferLoadingPlayerId).toBe('')
  })

  it('does not open a transfer from the current owner roster', async () => {
    const instance = context({ isOwner: true, seasonId: 'season-1', viewerTeamId: 'owner-team' })
    await page.openTransfer.call(instance, { currentTarget: { dataset: { playerId: 'player-1' } } })
    expect(mocks.transferCandidate).not.toHaveBeenCalled()
    expect(instance.data.transferCandidate).toBeNull()
  })

  it('shows the complete transfer submission confirmation after a successful request', async () => {
    const instance = context({ seasonId: 'season-1', viewerTeamId: 'buyer-team' })
    Object.assign(instance.data, {
      transferCandidate: { ownershipId: 'ownership-1', ownershipVersion: 3 },
      transferTargets: [{ teamId: 'buyer-team', teamName: '阿哈尔', teamNumber: 1 }],
      transferTargetIndex: 0,
      transferAmount: '1000',
      transferReason: '',
    })
    mocks.submitTransfer.mockResolvedValue({})

    await page.submitTransfer.call(instance)

    expect(mocks.submitTransfer).toHaveBeenCalledOnce()
    expect(instance.data.transferCandidate).toBeNull()
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: '提交成功',
      content: '已发送给对方确认',
      showCancel: false,
    }))
    expect(wx.showToast).not.toHaveBeenCalled()
  })
})
