import type { PlayerAcquisitionApplication, PlayerMarketAnnouncement, PlayerMarketPlayerSummary } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import {
  applicationCard,
  announcementCard,
  marketPlayerCard,
  mergeMarketPlayerPages,
  shouldShowMarketBackToTop,
} from './player-market.viewmodel'

const player = (overrides: Partial<PlayerMarketPlayerSummary> = {}): PlayerMarketPlayerSummary => ({
  playerId: 'player-1', playerName: 'Michele Di Gregorio', nationality: 'Italy', club: 'Juventus',
  currentOwner: null, ownershipId: null, ownershipVersion: null, officialValueMinor: 500, valuationVersion: 2,
  card: { playerCardId: 'card-1', cardName: '精选', imageUrl: null, position: 'GK', maxOverall: 96, salaryMinor: 300 },
  salary: { kind: 'PROJECTED', salaryMinor: 300, basisOverall: 96, salaryRuleVersionId: 'rule-1', currentTier: null, unavailableReason: null },
  forcedTransferBadge: false, action: 'APPLY', disabledReason: null, ...overrides,
})

const application = (overrides: Partial<PlayerAcquisitionApplication> = {}): PlayerAcquisitionApplication => ({
  id: 'app-1', leagueId: 'league-1', seasonId: 'season-1', transferWindowId: 'window-1', forcedOfferWindowId: null, type: 'NORMAL_PURCHASE',
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
  it('appends cursor pages once per player and replaces them for a fresh query', () => {
    const first = [{ playerId: 'player-1' }, { playerId: 'player-2' }]
    const second = [{ playerId: 'player-2' }, { playerId: 'player-3' }]

    expect(mergeMarketPlayerPages(first, second, 'append').map(({ playerId }) => playerId))
      .toEqual(['player-1', 'player-2', 'player-3'])
    expect(mergeMarketPlayerPages(first, second, 'replace').map(({ playerId }) => playerId))
      .toEqual(['player-2', 'player-3'])
  })

  it('reveals the return-to-top action only after meaningful scrolling', () => {
    expect(shouldShowMarketBackToTop(699)).toBe(false)
    expect(shouldShowMarketBackToTop(700)).toBe(true)
  })

  it('maps free, other-team, own, full-roster and closed-window actions', () => {
    expect(marketPlayerCard(player()).actionLabel).toBe('申请购买')
    expect(marketPlayerCard(player({ action: 'FORCE_SIGN', currentOwner: { teamId: 'team-2', teamNumber: 8, name: '成都蓉城', logoUrl: null, ownerAlias: 'Jeremy' } })).actionLabel).toBe('发起强报')
    expect(marketPlayerCard(player({ action: 'OWNED_BY_ME' })).actionLabel).toBe('本队球员')
    expect(marketPlayerCard(player({ action: 'DISABLED', disabledReason: 'ROSTER_FULL' }))).toMatchObject({ actionLabel: '先下放球员', releaseRequired: true })
    expect(marketPlayerCard(player({ action: 'DISABLED', disabledReason: 'TRANSFER_WINDOW_CLOSED' })).actionLabel).toBe('窗口未开放')
    expect(marketPlayerCard(player({ action: 'DISABLED', disabledReason: 'FORCED_OFFER_WINDOW_CLOSED' })).actionLabel).toBe('强报期未开放')
    expect(marketPlayerCard(player({ action: 'DISABLED', disabledReason: 'REQUOTE_REQUIRED' })).actionLabel).toBe('需重新报价')
    expect(marketPlayerCard(player({ action: 'DISABLED', disabledReason: 'OWNERSHIP_CHANGED' })).actionLabel).toBe('归属已变化')
  })

  it('shows Chinese club, localized nationality and league salary status', () => {
    expect(marketPlayerCard(player({ nationality: 'Italy', clubZh: '尤文图斯' }))).toMatchObject({
      nationalityLabel: '意大利', clubLabel: '尤文图斯', salaryLabel: '300', salaryHeading: '预计签入工资',
    })
    expect(marketPlayerCard(player({ nationality: null, club: null, card: null,
      salary: { kind: 'UNAVAILABLE', salaryMinor: null, basisOverall: null, salaryRuleVersionId: null, currentTier: null, unavailableReason: 'AUTO_BUILD_MISSING' } }))).toMatchObject({
      nationalityLabel: '国籍未知', clubLabel: '俱乐部未知', salaryLabel: '暂无可靠报价', salaryHeading: '预计签入工资',
    })
    expect(marketPlayerCard(player({ salary: { kind: 'ACTUAL', salaryMinor: 400, basisOverall: 96, salaryRuleVersionId: 'old-rule', currentTier: null, unavailableReason: null } })))
      .toMatchObject({ salaryHeading: '实际工资', salaryLabel: '400' })
  })

  it('shows only recorded age, height, weight and preferred foot', () => {
    expect(marketPlayerCard(player({ age: 39, heightCm: 170, weightKg: 67, preferredFoot: 'LEFT' })).profileFacts)
      .toEqual([
        { key: 'age', label: '年龄', value: '39岁' },
        { key: 'height', label: '身高', value: '170cm' },
        { key: 'weight', label: '体重', value: '67kg' },
        { key: 'foot', label: '惯用脚', value: '左脚' },
      ])
    expect(marketPlayerCard(player({ preferredFoot: 'RIGHT' })).profileFacts)
      .toEqual([{ key: 'foot', label: '惯用脚', value: '右脚' }])
    expect(marketPlayerCard(player()).profileFacts).toEqual([])
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
    expect(announcementCard(notice)).toMatchObject({ kindLabel: '强报新闻', amountLabel: '500', message: '强报成交' })
    expect(announcementCard(notice)).toMatchObject({ sourceLabel: '原球队未记录', targetLabel: '新球队未记录',
      source: { numberCopy: '', fallback: '?', hasTeam: false }, target: { numberCopy: '', hasTeam: false } })
    expect(announcementCard({ ...notice, kind: 'NORMAL_PURCHASE' })).toMatchObject({
      sourceLabel: '自由球员', source: { name: '自由球员', numberCopy: '', fallback: '自', hasTeam: false },
    })
    expect(announcementCard({ ...notice, kind: 'RELEASE' })).toMatchObject({ targetLabel: '自由球员', target: { name: '自由球员', hasTeam: false } })
    expect(announcementCard({ ...notice, sourceTeam: application().applicantTeam, targetTeam: { ...application().applicantTeam, name: '海牙', ownerAlias: '海牙老板', logoUrl: 'https://example.com/crest.png' }, valuationSnapshotMinor: 400 }))
      .toMatchObject({ sourceLabel: '巴塞罗那（小新（潇洒））', targetLabel: '海牙（海牙老板）', valuationLabel: '400',
        source: { numberCopy: '4 号', fallback: '巴', name: '巴塞罗那', ownerAlias: '小新（潇洒）' },
        target: { numberCopy: '4 号', logoUrl: 'https://example.com/crest.png', name: '海牙', ownerAlias: '海牙老板' } })
  })
})
