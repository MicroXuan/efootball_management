import type { PublicTeamAssets, TeamAssetOverview } from '@efm/contracts'

type AssetStatus = 'ACTIVE'|'DISAPPEARED'|'RETIRED'

function money(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function date(value: string | null) {
  return value ? value.slice(0, 10).replace(/-/g, '.') : null
}

export function teamAssetsView(assets: TeamAssetOverview | PublicTeamAssets, viewer?: { teamId: string; seasonId: string; teamName?: string; teamNumber?: number | null } | null, pendingDisappearanceIds: string[] = []) {
  const owner = 'ownerPublicUserNo' in assets ? assets : null
  const nextOpening = date(owner?.nextTransferWindowStartAt ?? null)
  const players = assets.players.map((player) => {
    const ownershipId = 'ownershipId' in player ? player.ownershipId : undefined
    const ownershipVersion = 'ownershipVersion' in player ? player.ownershipVersion : undefined
    const canRelease = 'canRelease' in player ? player.canRelease : false
    const releaseDisabledReason = 'releaseDisabledReason' in player ? player.releaseDisabledReason : null
    const forcedTransferBadge = 'forcedTransferBadge' in player ? player.forcedTransferBadge : false
    return {
    ...player,
    ownershipId,
    ownershipVersion,
    positionCopy: player.position ?? '位置待补',
    originCopy: `${player.nationality ?? '国籍待补'} · ${player.club ?? '俱乐部待补'}`,
    joinedCopy: date(player.acquiredAt) ?? '—',
    ageCopy: player.age === null ? '—' : `${player.age} 岁`,
    heightCopy: player.heightCm === null ? '—' : `${player.heightCm} cm`,
    footCopy: player.preferredFoot ?? '—',
    atCopy: player.atRating === null ? '—' : String(player.atRating),
    salaryCopy: money(player.salaryMinor),
    tagLabels: player.tags?.includes('FIXED_B') ? ['固B'] : [],
    valueCopy: player.currentValueMinor === null ? '待设置' : money(player.currentValueMinor),
    valuationCopy: player.lastEffectiveAt === null ? '暂无正式身价' : `更新于 ${date(player.lastEffectiveAt)}`,
    releaseEnabled: Boolean(owner) && player.rosterStatus === 'ACTIVE' && canRelease === true
      && Boolean(ownershipId && ownershipVersion && owner?.seasonId && owner?.activeTransferWindowId),
    pendingDisappearance: Boolean(ownershipId && pendingDisappearanceIds.includes(ownershipId)),
    disappearanceEnabled: Boolean(owner) && player.rosterStatus === 'ACTIVE' && Boolean(ownershipId && ownershipVersion && owner?.seasonId) && !pendingDisappearanceIds.includes(ownershipId ?? ''),
    transferVisible: !owner && player.rosterStatus === 'ACTIVE' && Boolean(viewer && viewer.teamId !== assets.teamId),
    forcedVisible: !owner && player.rosterStatus === 'ACTIVE' && Boolean(viewer && viewer.teamId !== assets.teamId),
    releaseDisabledCopy: !owner ? '' : player.rosterStatus !== 'ACTIVE'
      ? '仅现役球员可下放'
      : releaseDisabledReason === 'TRANSFER_WINDOW_CLOSED'
        ? nextOpening ? `转会期未开放，预计 ${nextOpening} 开放` : '转会期未开放' : '',
    forcedTransferLabel: forcedTransferBadge ? '本赛季强报' : ''
  }})
  const group = (status: AssetStatus) => players.filter((player) => player.rosterStatus === status)
  const active = group('ACTIVE')
  const disappeared = group('DISAPPEARED')
  const retired = group('RETIRED')
  const valueSuffix = assets.valuationCompleteness === 'COMPLETE' ? '' : '+'
  const teamNumber = assets.teamNumber === null ? '待编号' : `${String(assets.teamNumber).padStart(2, '0')}号`
  return {
    ...assets,
    isOwner: Boolean(owner),
    seasonId: owner?.seasonId ?? viewer?.seasonId ?? null,
    viewerTeamId: owner?.teamId ?? viewer?.teamId ?? null,
    viewerTeamName: owner?.teamName ?? viewer?.teamName ?? null,
    viewerTeamNumber: owner?.teamNumber ?? viewer?.teamNumber ?? null,
    activeTransferWindowId: owner?.activeTransferWindowId ?? null,
    ownerPublicUserNo: owner?.ownerPublicUserNo ?? null,
    ownerAvatarUrl: owner?.ownerAvatarUrl ?? null,
    overCap: assets.salaryCapMinor !== null && assets.activeSalaryMinor > assets.salaryCapMinor,
    identity: `${assets.teamNumber ?? '—'} · ${assets.teamName}`,
    ownerCopy: owner ? `${assets.ownerAlias} · ${owner.ownerPublicUserNo}` : assets.ownerAlias,
    identityCopy: `${teamNumber}-${assets.teamName}-${assets.ownerAlias}`,
    teamBadgeUrl: assets.teamLogoUrl,
    teamBadgeText: Array.from(assets.teamName)[0] ?? '队',
    teamNumberCopy: assets.teamNumber === null ? '球队编号待分配' : `球队编号 ${String(assets.teamNumber).padStart(2, '0')}`,
    divisionCopy: owner?.divisionName ?? (owner ? '组别待公布' : ''),
    totalCopy: assets.valuationCompleteness === 'COMPLETE' ? String(assets.totalKnownValueMinor) : `${assets.totalKnownValueMinor}+`,
    shellCopy: money(assets.shellValueMinor),
    salaryCopy: `${money(assets.activeSalaryMinor)} / ${assets.salaryCapMinor === null ? '待管理员设置' : money(assets.salaryCapMinor)}`,
    playerValueCopy: `${money(assets.knownPlayerValueMinor)}${valueSuffix}`,
    tabs: [
      { key: 'ACTIVE' as const, label: '一线阵容', count: active.length },
      { key: 'DISAPPEARED' as const, label: '已消失', count: disappeared.length },
      { key: 'RETIRED' as const, label: '已退役', count: retired.length }
    ],
    active, disappeared, retired
  }
}

export function forcedOfferRoute(view: ReturnType<typeof teamAssetsView>, playerId: string): string | null {
  if (view.isOwner || !view.viewerTeamId || !view.seasonId) return null
  return `/pages/player-market-detail/index?leagueId=${encodeURIComponent(view.leagueId)}&seasonId=${encodeURIComponent(view.seasonId)}&teamId=${encodeURIComponent(view.viewerTeamId)}&playerId=${encodeURIComponent(playerId)}`
}
