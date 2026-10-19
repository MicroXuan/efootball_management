import type {
  MyPlayerAuctionListItem,
  MyPlayerAuctionRoom,
  MyPlayerAuctionSaleListResponse,
  PlaceMiniprogramAuctionBidRequest,
  PlayerAuctionBidResult,
} from '@efm/contracts'
import { api } from './api'

export type PlayerAuctionBidDecision = {
  id: string
  result: PlayerAuctionBidResult
  teamName: string | null
  amount: number
  deadlineAt: string | null
  requiredMinimum?: number
}

export type PlayerAuctionBidSubmission = {
  input: PlaceMiniprogramAuctionBidRequest
  idempotencyKey: string
}

const id = (value: string) => encodeURIComponent(value)

export function playerAuctionSalesPath(query: { keyword?: string; cursor?: string; limit?: number } = {}) {
  const params = [
    query.keyword?.trim() ? ['keyword', query.keyword.trim()] : undefined,
    query.cursor ? ['cursor', query.cursor] : undefined,
    ['limit', String(query.limit ?? 20)],
  ].filter((entry): entry is string[] => Boolean(entry))
  return `/me/player-auction-sales?${params.map(([key, value]) => `${encodeURIComponent(key!)}=${encodeURIComponent(value!)}`).join('&')}`
}

export function listMyPlayerAuctionSales(query: { keyword?: string; cursor?: string; limit?: number } = {}) {
  return api.request<MyPlayerAuctionSaleListResponse>({ path: playerAuctionSalesPath(query) })
}

export function createPlayerAuctionBidSubmission(
  input: PlaceMiniprogramAuctionBidRequest,
  entropy = Math.random().toString(36).slice(2, 12),
): PlayerAuctionBidSubmission {
  return { input, idempotencyKey: `${Date.now().toString(36)}-${entropy}` }
}

export async function listMyPlayerAuctions(status: 'active' | 'all' = 'active'): Promise<MyPlayerAuctionListItem[]> {
  const response = await api.request<{ items: MyPlayerAuctionListItem[] }>({ path: `/me/player-auctions?status=${status}` })
  return response.items
}

export async function getMyPlayerAuction(batchId: string): Promise<MyPlayerAuctionRoom> {
  return api.request<MyPlayerAuctionRoom>({ path: `/me/player-auctions/${id(batchId)}` })
}

export function placeMyPlayerAuctionBid(
  batchId: string,
  input: PlaceMiniprogramAuctionBidRequest,
  idempotencyKey: string,
): Promise<PlayerAuctionBidDecision> {
  return api.request<PlayerAuctionBidDecision>({
    path: `/me/player-auctions/${id(batchId)}/bids`,
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    data: input,
  })
}
