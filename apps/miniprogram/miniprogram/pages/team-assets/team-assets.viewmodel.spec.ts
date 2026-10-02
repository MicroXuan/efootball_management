import type { TeamAssetOverview } from '@efm/contracts'
import { expect, it } from 'vitest'
import { teamAssetsView } from './team-assets.viewmodel'

it('presents team identity, owner, totals and three roster groups', () => {
  const player = (rosterStatus: 'ACTIVE'|'DISAPPEARED'|'RETIRED', playerId: string) => ({ playerId, playerName: playerId, cardName: '卡片', cardImageUrl: null, position: 'CF', nationality: null, club: null, age: null, heightCm: null, preferredFoot: null, atRating: null, acquiredAt: '2026-10-01T00:00:00.000Z', salaryMinor: 100, rosterStatus, currentValueMinor: rosterStatus === 'ACTIVE' ? 1000 : null, lastEffectiveAt: null })
  const value: TeamAssetOverview = { leagueId: 'league-1', teamId: 'team-1', teamName: '海港竞技', teamNumber: 7, teamLogoUrl: null, ownerDisplayName: '小宣', ownerPublicUserNo: '100069', ownerAvatarUrl: null, shellValueMinor: 5000, knownPlayerValueMinor: 1000, totalKnownValueMinor: 6000, valuationCompleteness: 'INCOMPLETE', missingValuationCount: 1, activePlayerCount: 1, activeSalaryMinor: 100, players: [player('ACTIVE', '一线'), player('DISAPPEARED', '消失'), player('RETIRED', '退役')] }
  expect(teamAssetsView(value)).toMatchObject({ identity: '7 · 海港竞技', ownerCopy: '小宣 · 100069', completenessCopy: '缺少 1 人身价', totalCopy: '6000+', active: [{ playerId: '一线' }], disappeared: [{ playerId: '消失' }], retired: [{ playerId: '退役' }] })
})
