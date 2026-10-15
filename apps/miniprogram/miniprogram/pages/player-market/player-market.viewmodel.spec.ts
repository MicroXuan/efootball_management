import type { PlayerAcquisitionApplication, PlayerMarketAnnouncement, PlayerMarketPlayerSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { applicationCard, announcementCard, marketPlayerCard } from './player-market.viewmodel'

const player = (overrides: Partial<PlayerMarketPlayerSummary> = {}): PlayerMarketPlayerSummary => ({
  playerId: 'player-1', playerName: 'Michele Di Gregorio', nationality: 'Italy', club: 'Juventus',
  currentOwner: null, ownershipId: null, ownershipVersion: null, officialValueMinor: 500, valuationVersion: 2,
  card: { playerCardId: 'card-1', cardName: '精选', imageUrl: null, position: 'GK', maxOverall: 96, salaryMinor: 300 },
  forcedTransferBadge: false, action: 'APPLY', disabledReason: null, ...overrides,
})

const application = (overrides: Partial<PlayerAcquisitionApplication> = {}): PlayerAcquisitionApplication => ({
  id: 'app-1', leagueId: 'league-1', seasonId: 'season-1', transferWindowId: 'window-1', type: 'NORMAL_PURCHASE',
  applicantTeam: { teamId: 'team-1', teamNumber: 4, name: '巴塞罗那', logoUrl: null, ownerAlias: '小新（潇洒）' },
  playerId: 'player-1', playerName: 'Michele Di Gregorio', playerCard: player().card!, sourceTeam: null,
  ownershipId: null, ownershipVersionSnapshot: null, amountMinor: 500, valuationMinorSnapshot: 500,
  valuationVersionSnapshot: 2, status: 'PENDING', queuePosition: 1,
  firstValidSubmittedAt: '2026-10-14T00:00:00.000Z', lastSubmittedAt: '2026-10-14T01:00:00.000Z',
  reviewedAt: null, reviewReason: null, version: 2, events: [
    { id: 'event-1', type: 'SUBMITTED', fromStatus: null, toStatus: 'PENDING', fromAmountMinor: null, toAmountMinor: 400, actorType: 'USER', actorDisplayName: '小新', reason: null, createdAt: '2026-10-14T00:00:00.000Z' },
    { id: 'event-2', type: 'AMOUNT_CHANGED', fromStatus: 'PENDING', toStatus: 'PENDING', fromAmountMinor: 400, toAmountMinor: 500, actorType: 'USER', actorDisplayName: '小新', reason: '提高报价', createdAt: '2026-10-14T01:00:00.000Z' },
  ], ...overrides,
})

describe('player market list view model', () => {
  it('maps free, other-team, own, full-roster and closed-window actions', () => {
    expect(marketPlayerCard(player()).actionLabel).toBe('申请购买')
    expect(marketPlayerCard(player({ action: 'FORCE_SIGN', currentOwner: { teamId: 'team-2', teamNumber: 8, name: '成都蓉城', logoUrl: null, ownerAlias: 'Jeremy' } })).actionLabel).toBe('发起强报')
    expect(marketPlayerCard(player({ action: 'OWNED_BY_ME' })).actionLabel).toBe('本队球员')
    expect(marketPlayerCard(player({ action: 'DISABLED', disabledReason: 'ROSTER_FULL' }))).toMatchObject({ actionLabel: '先下放球员', releaseRequired: true })
    expect(marketPlayerCard(player({ action: 'DISABLED', disabledReason: 'TRANSFER_WINDOW_CLOSED' })).actionLabel).toBe('窗口未开放')
    expect(marketPlayerCard(player({ action: 'DISABLED', disabledReason: 'REQUOTE_REQUIRED' })).actionLabel).toBe('需重新报价')
    expect(marketPlayerCard(player({ action: 'DISABLED', disabledReason: 'OWNERSHIP_CHANGED' })).actionLabel).toBe('归属已变化')
  })

  it('keeps team number, crest fallback, name and league alias for long owner names', () => {
    const card = marketPlayerCard(player({ currentOwner: {
      teamId: 'team-2', teamNumber: 18, name: '一支名称非常非常长的测试球队', logoUrl: null, ownerAlias: '公开联赛称呼',
    } }))
    expect(card.owner).toMatchObject({ numberLabel: '18', logoUrl: null, fallback: '一', name: '一支名称非常非常长的测试球队', ownerAlias: '公开联赛称呼' })
  })

  it('exposes the best-card portrait with a compact player-name fallback', () => {
    expect(marketPlayerCard(player({
      playerName: 'Michele Di Gregorio',
      card: { ...player().card!, imageUrl: 'https://cdn.example.test/player.png' },
    }))).toMatchObject({
      portraitUrl: 'https://cdn.example.test/player.png',
      portraitFallback: 'M',
    })

    expect(marketPlayerCard(player({ playerName: '米凯莱', card: null }))).toMatchObject({
      portraitUrl: '',
      portraitFallback: '米',
    })
  })

  it('shows every public application event, including review reasons', () => {
    const card = applicationCard(application({
      status: 'REJECTED', reviewReason: '阵容不合规', events: [
        ...application().events,
        { id: 'event-3', type: 'WITHDRAWN', fromStatus: 'PENDING', toStatus: 'WITHDRAWN', fromAmountMinor: 500, toAmountMinor: 500, actorType: 'USER', actorDisplayName: '小新', reason: '临时撤回', createdAt: '2026-10-14T02:00:00.000Z' },
        { id: 'event-4', type: 'REJECTED', fromStatus: 'PENDING', toStatus: 'REJECTED', fromAmountMinor: 500, toAmountMinor: 500, actorType: 'ADMIN', actorDisplayName: '管理员', reason: '阵容不合规', createdAt: '2026-10-14T03:00:00.000Z' },
      ],
    }))
    expect(card.timeline.map((item) => item.label)).toEqual(['首次提交', '修改报价', '撤回申请', '管理员驳回'])
    expect(card.timeline[card.timeline.length - 1]?.detail).toContain('阵容不合规')
  })

  it('maps transparent transaction announcements', () => {
    const notice: PlayerMarketAnnouncement = { id: 'n-1', kind: 'FORCED_TRANSFER', playerId: 'p-1', playerName: '球员甲', sourceTeam: null, targetTeam: null, amountMinor: 500, message: '强报成交', createdAt: '2026-10-14T00:00:00.000Z' }
    expect(announcementCard(notice)).toMatchObject({ kindLabel: '强报成交', amountLabel: '500', message: '强报成交' })
  })
})
