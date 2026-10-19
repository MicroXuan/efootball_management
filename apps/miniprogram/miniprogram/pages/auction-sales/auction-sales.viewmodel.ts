import type { MyPlayerAuctionSale, MyPlayerAuctionSaleListResponse } from '@efm/contracts'

export type AuctionSalesState = {
  items: MyPlayerAuctionSale[]
  nextCursor: string | null
  hasMore: boolean
}

export function mergeAuctionSales(
  previous: AuctionSalesState | undefined,
  response: MyPlayerAuctionSaleListResponse,
  mode: 'refresh' | 'append',
): AuctionSalesState {
  const source = mode === 'append' ? [...(previous?.items ?? []), ...response.items] : response.items
  const seen = new Set<string>()
  const items = source.filter((sale) => !seen.has(sale.id) && Boolean(seen.add(sale.id)))
  return { items, nextCursor: response.nextCursor, hasMore: response.nextCursor !== null }
}

export function isLatestSalesRequest(current: number, request: number, unloaded: boolean) {
  return !unloaded && current === request
}

export function auctionSaleCardPath(cardId: string) {
  return `/pages/player-card-detail/index?id=${encodeURIComponent(cardId)}`
}

export function formatConfirmedTime(value: string, offsetMinutes = -new Date().getTimezoneOffset()) {
  const date = new Date(Date.parse(value) + offsetMinutes * 60_000)
  const parts = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()]
  const [year, month, day, hour, minute] = parts.map((part) => String(part).padStart(2, '0'))
  return `${year}-${month}-${day} ${hour}:${minute}`
}

export function auctionSaleRows(items: MyPlayerAuctionSale[]) {
  return items.map((sale) => ({
    ...sale,
    playerFallback: sale.player.name.slice(0, 2),
    teamLabel: `${sale.winner.teamNumber === null ? '—' : sale.winner.teamNumber}号 · ${sale.winner.teamName}`,
    confirmedTimeLabel: formatConfirmedTime(sale.confirmedAt),
  }))
}
