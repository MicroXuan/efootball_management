import type { MyPlayerAuctionSale } from '@efm/contracts'
import { describe, expect, it } from 'vitest'
import { auctionSaleCardPath, auctionSaleRows, isLatestSalesRequest, mergeAuctionSales } from './auction-sales.viewmodel'

const sale = (id: string): MyPlayerAuctionSale => ({
  id, batchId: '22222222-2222-4222-8222-222222222222',
  league: { id: '33333333-3333-4333-8333-333333333333', name: 'CELL 联赛' },
  player: { id: '44444444-4444-4444-8444-444444444444', cardId: '55555555-5555-4555-8555-555555555555', name: '车范根', imageUrl: null, position: 'CF', overallRating: 96, cardType: 'EPIC' },
  winner: { teamId: '66666666-6666-4666-8666-666666666666', teamNumber: 7, teamName: '上海申花', bidderDisplayName: '小宣' },
  price: 170, confirmedAt: '2026-10-10T12:34:00.000Z',
})

describe('auction sales view model', () => {
  it('replaces on refresh and appends without duplicate sale ids', () => {
    const first = mergeAuctionSales(undefined, { items: [sale('11111111-1111-4111-8111-111111111111')], nextCursor: 'next' }, 'refresh')
    const next = mergeAuctionSales(first, { items: [sale(first.items[0]!.id), sale('77777777-7777-4777-8777-777777777777')], nextCursor: null }, 'append')
    expect(next.items.map(({ id }) => id)).toEqual(['11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777777'])
    expect(next.hasMore).toBe(false)
  })

  it('rejects stale responses and opens the exact card id', () => {
    expect(isLatestSalesRequest(3, 2, false)).toBe(false)
    expect(isLatestSalesRequest(3, 3, false)).toBe(true)
    expect(auctionSaleCardPath('card / 1')).toBe('/pages/player-card-detail/index?id=card%20%2F%201')
  })

  it('presents immutable team, bidder, price and confirmed time metadata', () => {
    expect(auctionSaleRows([sale('11111111-1111-4111-8111-111111111111')])[0]).toMatchObject({
      teamLabel: '7号 · 上海申花', price: 170,
      winner: { bidderDisplayName: '小宣' },
    })
  })
})
