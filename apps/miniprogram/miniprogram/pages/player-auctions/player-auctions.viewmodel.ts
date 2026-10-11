import type { MyPlayerAuctionListItem, PlayerAuctionBatchStatus } from '@efm/contracts'

export type PlayerAuctionLeagueGroup = {
  leagueId: string
  leagueName: string
  items: MyPlayerAuctionListItem[]
}

export function groupAuctionsByLeague(items: MyPlayerAuctionListItem[]): PlayerAuctionLeagueGroup[] {
  const groups = new Map<string, PlayerAuctionLeagueGroup>()
  for (const item of items) {
    const existing = groups.get(item.league.id)
    if (existing) existing.items.push(item)
    else groups.set(item.league.id, { leagueId: item.league.id, leagueName: item.league.name, items: [item] })
  }
  return [...groups.values()]
}

export function playerAuctionStatusLabel(status: PlayerAuctionBatchStatus): string {
  const labels: Record<PlayerAuctionBatchStatus, string> = {
    DRAFT: '草稿',
    READY: '等待开始',
    ACTIVE: '拍卖中',
    PAUSED: '已暂停',
    COMPLETED: '已结束',
    CANCELLED: '已取消',
    RECOVERY_REQUIRED: '等待恢复',
  }
  return labels[status]
}
