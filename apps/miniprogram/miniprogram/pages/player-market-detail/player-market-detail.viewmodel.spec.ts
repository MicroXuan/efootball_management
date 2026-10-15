import type { PlayerMarketPlayerDetail } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { detailAction, marketErrorAction, playerMarketDetailView } from './player-market-detail.viewmodel'

const detail = (overrides: Partial<PlayerMarketPlayerDetail> = {}): PlayerMarketPlayerDetail => ({
  playerId: 'player-1', playerName: 'Michele Di Gregorio', nationality: 'Italy', club: 'Juventus',
  activeTransferWindowId: 'window-1',
  currentOwner: { teamId: 'team-8', teamNumber: 8, name: '成都蓉城', logoUrl: null, ownerAlias: 'Jeremy' },
  ownershipId: 'ownership-1', ownershipVersion: 3, officialValueMinor: 500, valuationVersion: 2,
  card: { playerCardId: 'card-1', cardName: '精选', imageUrl: null, position: 'GK', maxOverall: 96, salaryMinor: 300 },
  forcedTransferBadge: true, action: 'FORCE_SIGN', disabledReason: null, myApplication: null, publicApplications: [], ...overrides,
})

describe('player market detail view model', () => {
  it('explains normal and forced applications before submission', () => {
    expect(detailAction(detail({ currentOwner: null, action: 'APPLY' }))).toMatchObject({ label: '申请购买', warning: '最高报价不代表必然获批' })
    expect(detailAction(detail())).toMatchObject({ label: '发起强报', warning: '原球队无需同意', minimumAmountMinor: 500 })
  })

  it('shows a forced-transfer badge only when supplied for the current season', () => {
    expect(playerMarketDetailView(detail()).showForcedTransferBadge).toBe(true)
    expect(playerMarketDetailView(detail({ forcedTransferBadge: false })).showForcedTransferBadge).toBe(false)
  })

  it('maps roster-full and stale-state errors to immediate recovery actions', () => {
    expect(marketErrorAction('ROSTER_FULL', 'team-1')).toEqual({ message: '阵容已满，请先下放一名球员', actionLabel: '去球队资产', route: '/pages/team-assets/index?teamId=team-1&returnTo=player-market' })
    expect(marketErrorAction('OWNERSHIP_CHANGED', 'team-1').message).toBe('球员归属已变化，已为你刷新最新状态')
    expect(marketErrorAction('REQUOTE_REQUIRED', 'team-1').message).toBe('官方身价已变化，请按最新身价重新报价')
  })
})
