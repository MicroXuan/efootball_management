import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import {
  amendPlayerApplication,
  listPlayerApplications,
  listPlayerMarket,
  listPlayerMarketAnnouncements,
  playerApplicationListPath,
  playerMarketListPath,
  submitPlayerApplication,
  withdrawPlayerApplication,
} from './player-market'

describe('player market service', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('encodes market filters and pagination without leaking empty values', () => {
    expect(playerMarketListPath('league / 1', {
      seasonId: 'season 1', keyword: '长 名称', position: 'CF', ownership: 'OWNED', cursor: 'next/page', limit: 24,
    })).toBe('/me/leagues/league%20%2F%201/player-market?seasonId=season%201&keyword=%E9%95%BF%20%E5%90%8D%E7%A7%B0&position=CF&ownership=OWNED&cursor=next%2Fpage&limit=24')
    expect(playerApplicationListPath('league-1', { seasonId: 'season-1', scope: 'MINE', limit: 30 }))
      .toBe('/me/leagues/league-1/player-market-applications?seasonId=season-1&scope=MINE&limit=30')
  })

  it('calls list and announcement endpoints with the server response envelope intact', async () => {
    const request = vi.spyOn(api, 'request').mockResolvedValue({ items: [], nextCursor: null })
    await listPlayerMarket('league-1', { seasonId: 'season-1', ownership: 'ALL', limit: 30 })
    await listPlayerApplications('league-1', { seasonId: 'season-1', scope: 'PUBLIC', limit: 30 })
    await listPlayerMarketAnnouncements('league-1', { seasonId: 'season-1', limit: 30 })
    expect(request.mock.calls.map(([options]) => options.path)).toEqual([
      '/me/leagues/league-1/player-market?seasonId=season-1&ownership=ALL&limit=30',
      '/me/leagues/league-1/player-market-applications?seasonId=season-1&scope=PUBLIC&limit=30',
      '/me/leagues/league-1/player-market-announcements?seasonId=season-1&limit=30',
    ])
  })

  it('sends idempotency keys and optimistic versions for every mutation', async () => {
    const request = vi.spyOn(api, 'request').mockResolvedValue({ id: 'application-1' })
    await submitPlayerApplication('league-1', {
      seasonId: 'season-1', transferWindowId: 'window-1', footballPlayerId: 'player-1', playerCardId: 'card-1',
      type: 'FORCED_TRANSFER', amountMinor: 500, sourceLeagueTeamId: 'team-2', ownershipId: 'owner-1', ownershipVersionSnapshot: 4,
    }, 'submit-key')
    await amendPlayerApplication('application / 1', { amountMinor: 600, expectedVersion: 7 }, 'amend-key')
    await withdrawPlayerApplication('application / 1', { expectedVersion: 8, reason: '改选其他球员' }, 'withdraw-key')

    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: '/me/leagues/league-1/player-market-applications', method: 'POST', headers: { 'Idempotency-Key': 'submit-key' },
      data: expect.objectContaining({ ownershipVersionSnapshot: 4 }),
    }))
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: '/me/player-market-applications/application%20%2F%201', method: 'PATCH', headers: { 'Idempotency-Key': 'amend-key' },
      data: { amountMinor: 600, expectedVersion: 7 },
    }))
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({
      path: '/me/player-market-applications/application%20%2F%201/withdraw', method: 'POST', headers: { 'Idempotency-Key': 'withdraw-key' },
      data: { expectedVersion: 8, reason: '改选其他球员' },
    }))
  })
})
