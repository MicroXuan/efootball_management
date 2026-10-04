import type { TeamAssetOverview } from '@efm/contracts'
import { expect, it } from 'vitest'
import { teamAssetsView } from './team-assets.viewmodel'

it('presents team identity, owner, totals and three roster groups', () => {
  const player = (rosterStatus: 'ACTIVE'|'DISAPPEARED'|'RETIRED', playerId: string) => ({ playerId, playerName: playerId, cardName: '卡片', cardImageUrl: null, position: 'CF', nationality: null, club: null, age: null, heightCm: null, preferredFoot: null, atRating: null, acquiredAt: '2026-10-01T00:00:00.000Z', salaryMinor: 100, rosterStatus, currentValueMinor: rosterStatus === 'ACTIVE' ? 1000 : null, lastEffectiveAt: null })
  const value: TeamAssetOverview = { leagueId: 'league-1', teamId: 'team-1', teamName: '海港竞技', teamNumber: 7, divisionName: null, teamLogoUrl: null, ownerDisplayName: '小宣', ownerPublicUserNo: '100069', ownerAvatarUrl: null, shellValueMinor: 5000, knownPlayerValueMinor: 1000, totalKnownValueMinor: 6000, valuationCompleteness: 'INCOMPLETE', missingValuationCount: 1, activePlayerCount: 1, activeSalaryMinor: 100, players: [player('ACTIVE', '一线'), player('DISAPPEARED', '消失'), player('RETIRED', '退役')] }
  expect(teamAssetsView(value)).toMatchObject({
    identityCopy: '07号 · 海港竞技 · 小宣',
    ownerCopy: '小宣 · 100069',
    ownerAvatarUrl: null,
    ownerAvatarText: '小',
    completenessCopy: '缺少 1 人身价',
    playerValueCopy: '1,000+',
    totalAssetCopy: '6,000+',
    active: [{ playerId: '一线' }],
    disappeared: [{ playerId: '消失' }],
    retired: [{ playerId: '退役' }],
  })
})

it('presents every player asset field with Chinese labels and readable fallbacks', () => {
  const value: TeamAssetOverview = {
    leagueId: 'league-1', teamId: 'team-1', teamName: '海港竞技', teamNumber: 7, divisionName: '冠军 A 组',
    teamLogoUrl: 'https://example.com/team.png', ownerDisplayName: '小宣', ownerPublicUserNo: '100069',
    ownerAvatarUrl: 'https://example.com/owner.png', shellValueMinor: 5000, knownPlayerValueMinor: 8800,
    totalKnownValueMinor: 13800, valuationCompleteness: 'COMPLETE', missingValuationCount: 0,
    activePlayerCount: 2, activeSalaryMinor: 450,
    players: [
      {
        playerId: 'player-1', playerName: '莱昂内尔·梅西', cardName: '史诗高光',
        cardImageUrl: 'https://example.com/player.png', position: 'RWF', nationality: '阿根廷', club: '迈阿密国际',
        age: 39, heightCm: 170, preferredFoot: '左脚', atRating: 103,
        acquiredAt: '2026-10-01T12:30:00.000Z', salaryMinor: 300, rosterStatus: 'ACTIVE',
        currentValueMinor: 8800, lastEffectiveAt: '2026-10-02T00:00:00.000Z'
      },
      {
        playerId: 'player-2', playerName: '资料待补球员', cardName: '基础卡', cardImageUrl: null,
        position: null, nationality: null, club: null, age: null, heightCm: null, preferredFoot: null,
        atRating: null, acquiredAt: '2026-09-08T00:00:00.000Z', salaryMinor: 150,
        rosterStatus: 'ACTIVE', currentValueMinor: null, lastEffectiveAt: null
      }
    ]
  }

  const view = teamAssetsView(value)

  expect(view).toMatchObject({
    teamBadgeUrl: 'https://example.com/team.png',
    teamBadgeText: '海',
    ownerAvatarUrl: 'https://example.com/owner.png',
    ownerAvatarText: '小',
    identityCopy: '07号 · 海港竞技 · 小宣',
    divisionCopy: '冠军 A 组',
    playerValueCopy: '8,800',
    totalAssetCopy: '13,800',
    salaryCopy: '450',
    shellCopy: '5,000',
  })
  expect(view.tabs).toEqual([
    { key: 'ACTIVE', label: '一线阵容', count: 2 },
    { key: 'DISAPPEARED', label: '已消失', count: 0 },
    { key: 'RETIRED', label: '已退役', count: 0 }
  ])
  expect(view.active[0]).toMatchObject({
    playerName: '莱昂内尔·梅西', cardCopy: '史诗高光 · RWF', originCopy: '阿根廷 · 迈阿密国际',
    joinedCopy: '2026.10.01', ageCopy: '39 岁', heightCopy: '170 cm', footCopy: '左脚', atCopy: '103',
    salaryCopy: '300', valueCopy: '8,800', valuationCopy: '更新于 2026.10.02'
  })
  expect(view.active[1]).toMatchObject({
    cardCopy: '基础卡 · 位置待补', originCopy: '国籍待补 · 俱乐部待补', ageCopy: '—', heightCopy: '—',
    footCopy: '—', atCopy: '—', valueCopy: '待设置', valuationCopy: '暂无正式身价'
  })
})
