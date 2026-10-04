import type { TeamAssetOverview } from '@efm/contracts'

type AssetStatus = 'ACTIVE'|'DISAPPEARED'|'RETIRED'

function money(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function date(value: string | null) {
  return value ? value.slice(0, 10).replace(/-/g, '.') : null
}

export function teamAssetsView(assets: TeamAssetOverview) {
  const players = assets.players.map((player) => ({
    ...player,
    cardCopy: `${player.cardName} · ${player.position ?? '位置待补'}`,
    originCopy: `${player.nationality ?? '国籍待补'} · ${player.club ?? '俱乐部待补'}`,
    joinedCopy: date(player.acquiredAt) ?? '—',
    ageCopy: player.age === null ? '—' : `${player.age} 岁`,
    heightCopy: player.heightCm === null ? '—' : `${player.heightCm} cm`,
    footCopy: player.preferredFoot ?? '—',
    atCopy: player.atRating === null ? '—' : String(player.atRating),
    salaryCopy: money(player.salaryMinor),
    valueCopy: player.currentValueMinor === null ? '待设置' : money(player.currentValueMinor),
    valuationCopy: player.lastEffectiveAt === null ? '暂无正式身价' : `更新于 ${date(player.lastEffectiveAt)}`
  }))
  const group = (status: AssetStatus) => players.filter((player) => player.rosterStatus === status)
  const active = group('ACTIVE')
  const disappeared = group('DISAPPEARED')
  const retired = group('RETIRED')
  return {
    ...assets,
    identity: `${assets.teamNumber ?? '—'} · ${assets.teamName}`,
    ownerCopy: `${assets.ownerDisplayName} · ${assets.ownerPublicUserNo}`,
    badgeUrl: assets.teamLogoUrl ?? assets.ownerAvatarUrl,
    badgeText: Array.from(assets.teamName)[0] ?? '队',
    teamNumberCopy: assets.teamNumber === null ? '球队编号待分配' : `球队编号 ${String(assets.teamNumber).padStart(2, '0')}`,
    divisionCopy: assets.divisionName ?? '组别待公布',
    completenessCopy: assets.valuationCompleteness === 'COMPLETE' ? '身价数据完整' : `缺少 ${assets.missingValuationCount} 人身价`,
    totalCopy: assets.valuationCompleteness === 'COMPLETE' ? String(assets.totalKnownValueMinor) : `${assets.totalKnownValueMinor}+`,
    shellCopy: money(assets.shellValueMinor),
    salaryCopy: money(assets.activeSalaryMinor),
    totalDisplayCopy: `${money(assets.totalKnownValueMinor)}${assets.valuationCompleteness === 'COMPLETE' ? '' : '+'}`,
    tabs: [
      { key: 'ACTIVE' as const, label: '一线阵容', count: active.length },
      { key: 'DISAPPEARED' as const, label: '已消失', count: disappeared.length },
      { key: 'RETIRED' as const, label: '已退役', count: retired.length }
    ],
    active, disappeared, retired
  }
}
