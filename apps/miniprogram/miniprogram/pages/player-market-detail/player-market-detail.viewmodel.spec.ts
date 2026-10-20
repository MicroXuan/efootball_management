import type { PlayerMarketPlayerDetail } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { buildPlayerApplicationInput, canEditPlayerApplication, detailAction, marketErrorAction, playerMarketDetailView, rejectedApplicationAction } from './player-market-detail.viewmodel'

const detail = (overrides: Partial<PlayerMarketPlayerDetail> = {}): PlayerMarketPlayerDetail => ({
  playerId: 'player-1', playerName: 'Michele Di Gregorio', playerEnglishName: 'Michele Di Gregorio', nationality: 'Italy', club: 'Juventus',
  activeTransferWindowId: 'window-1',
  activeForcedOfferWindowId: 'forced-1',
  currentOwner: { teamId: 'team-8', teamNumber: 8, name: '成都蓉城', logoUrl: null, ownerAlias: 'Jeremy' },
  ownershipId: 'ownership-1', ownershipVersion: 3, officialValueMinor: 500, valuationVersion: 2,
  card: { playerCardId: 'card-1', cardName: '精选', imageUrl: null, position: 'GK', maxOverall: 96, salaryMinor: 300 },
  salary: { kind: 'ACTUAL', salaryMinor: 300, basisOverall: 96, salaryRuleVersionId: 'old-rule', currentTier: { salaryMinor: 500, minOverall: 93, maxOverall: 99, salaryRuleVersionId: 'new-rule', version: 2, effectiveAt: '2026-10-20T00:00:00.000Z' }, unavailableReason: null },
  salaryImpact: { currentSalaryMinor: 700, salaryCapMinor: 1000, projectedSalaryMinor: 1000, overCapMinor: 0 },
  forcedTransferBadge: true, action: 'FORCE_SIGN', disabledReason: null, myApplication: null, publicApplications: [], ...overrides,
})

describe('player market detail view model', () => {
  it('keeps actual salary distinct from the current tier and bid price', () => {
    expect(playerMarketDetailView(detail())).toMatchObject({
      salaryHeading: '实际工资', salaryLabel: '300', currentTierLabel: '现行档位 500',
      salaryImpact: { currentLabel: '700', capLabel: '1000', projectedLabel: '1000', overCapLabel: '' },
    })
  })
  it('shows over-cap impact and unknown cap without blocking the action', () => {
    expect(playerMarketDetailView(detail({ salaryImpact: { currentSalaryMinor: 700, salaryCapMinor: 800, projectedSalaryMinor: 1000, overCapMinor: 200 } })))
      .toMatchObject({ salaryImpact: { overCapLabel: '预计超出 200' }, actionEnabled: true })
    expect(playerMarketDetailView(detail({ salaryImpact: { currentSalaryMinor: 700, salaryCapMinor: null, projectedSalaryMinor: 1000, overCapMinor: null } })))
      .toMatchObject({ salaryImpact: { capLabel: '未设置', projectedLabel: '1000' } })
  })
  it('shows the same recorded physical facts as the market list', () => {
    expect(playerMarketDetailView(detail({ age: 27, heightCm: 186, weightKg: 78, preferredFoot: 'RIGHT' })).profileFacts.map((fact) => fact.value))
      .toEqual(['27岁', '186cm', '78kg', '右脚'])
  })
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
    expect(marketErrorAction('OFFICIAL_VALUE_REQUIRED', 'team-1').message).toBe('该球员尚未设置官方身价，暂不能发起强报')
    expect(marketErrorAction('FORCED_AMOUNT_BELOW_OFFICIAL_VALUE', 'team-1').message).toBe('强报金额不得低于当前官方身价，请刷新后重新报价')
  })

  it('explains why a rival player without an official value cannot be force-signed', () => {
    const card = playerMarketDetailView(detail({ officialValueMinor: null, action: 'DISABLED', disabledReason: 'OFFICIAL_VALUE_REQUIRED' }))
    expect(card.actionEnabled).toBe(false)
    expect(card.actionLabel).toBe('待设置身价')
  })

  it('submits an owned player against the forced period even when transfers are closed', () => {
    const input = buildPlayerApplicationInput(detail({ activeTransferWindowId: null }), 700, 'season-1')
    expect(input).toMatchObject({ type: 'FORCED_TRANSFER', window: { kind: 'FORCED_OFFER', id: 'forced-1' }, amountMinor: 700 })
    expect(input).not.toHaveProperty('transferWindowId')
    expect(buildPlayerApplicationInput(detail({ activeForcedOfferWindowId: null }), 700, 'season-1')).toBeNull()
  })

  it('uses the transfer period only for free players and blocks missing windows', () => {
    expect(buildPlayerApplicationInput(detail({ action: 'APPLY', currentOwner: null, activeForcedOfferWindowId: null }), 500, 'season-1'))
      .toMatchObject({ type: 'NORMAL_PURCHASE', window: { kind: 'TRANSFER', id: 'window-1' } })
    expect(buildPlayerApplicationInput(detail({ action: 'APPLY', currentOwner: null, activeTransferWindowId: null }), 500, 'season-1')).toBeNull()
  })

  it('ends price edits with the matching period while keeping withdrawal separate', () => {
    const forced = { type: 'FORCED_TRANSFER', forcedOfferWindowId: 'forced-1', transferWindowId: null, status: 'PENDING' } as const
    expect(canEditPlayerApplication(detail(), forced)).toBe(true)
    expect(canEditPlayerApplication(detail({ activeForcedOfferWindowId: null }), forced)).toBe(false)
    expect(marketErrorAction('FORCED_OFFER_WINDOW_CLOSED', 'team-1').message).toContain('强报期')
  })

  it('offers a new application after rejection only while the relevant window is open', () => {
    const rejected = { status: 'REJECTED', type: 'FORCED_TRANSFER' } as NonNullable<PlayerMarketPlayerDetail['myApplication']>
    expect(rejectedApplicationAction(detail({ myApplication: rejected }))).toMatchObject({
      enabled: true, actionLabel: '重新发起强报',
    })
    expect(rejectedApplicationAction(detail({ myApplication: rejected, action: 'DISABLED', activeForcedOfferWindowId: null, disabledReason: 'FORCED_OFFER_WINDOW_CLOSED' }))).toMatchObject({
      enabled: false, hint: expect.stringContaining('等待下一次强报期'),
    })
    expect(rejectedApplicationAction(detail())).toBeNull()
  })

  it('offers a fresh forced offer after withdrawal and explains a closed window', () => {
    const withdrawn = { status: 'WITHDRAWN', type: 'FORCED_TRANSFER' } as NonNullable<PlayerMarketPlayerDetail['myApplication']>
    expect(rejectedApplicationAction(detail({ myApplication: withdrawn }))).toMatchObject({
      enabled: true, actionLabel: '重新发起强报', hint: expect.stringContaining('已撤回'),
    })
    expect(rejectedApplicationAction(detail({ myApplication: withdrawn, action: 'DISABLED', activeForcedOfferWindowId: null, disabledReason: 'FORCED_OFFER_WINDOW_CLOSED' }))).toMatchObject({
      enabled: false, hint: expect.stringContaining('等待下一次强报期'),
    })
  })
})
