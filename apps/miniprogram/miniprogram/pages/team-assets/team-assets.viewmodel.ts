import type { TeamAssetOverview } from '@efm/contracts'

export function teamAssetsView(assets: TeamAssetOverview) {
  const group = (status: 'ACTIVE'|'DISAPPEARED'|'RETIRED') => assets.players.filter((player) => player.rosterStatus === status)
  return {
    ...assets,
    identity: `${assets.teamNumber ?? '—'} · ${assets.teamName}`,
    ownerCopy: `${assets.ownerDisplayName} · ${assets.ownerPublicUserNo}`,
    completenessCopy: assets.valuationCompleteness === 'COMPLETE' ? '身价数据完整' : `缺少 ${assets.missingValuationCount} 人身价`,
    totalCopy: assets.valuationCompleteness === 'COMPLETE' ? String(assets.totalKnownValueMinor) : `${assets.totalKnownValueMinor}+`,
    active: group('ACTIVE'), disappeared: group('DISAPPEARED'), retired: group('RETIRED'),
  }
}
