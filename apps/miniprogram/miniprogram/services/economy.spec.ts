import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { economyApi } from './economy'
import { leagueTeamsApi } from './league-teams'

describe('economy release API', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('submits complete optimistic release context with an idempotency key', async () => {
    const request = vi.spyOn(api, 'request').mockResolvedValue({})
    await economyApi.releasePlayer('team / 1', 'ownership / 1', {
      seasonId: 'season-1', transferWindowId: 'window-1', ownershipId: 'ownership / 1',
      expectedVersion: 4, reason: '为新球员腾出阵容名额',
    }, 'release-key')

    expect(request).toHaveBeenCalledWith({
      path: '/me/league-teams/team%20%2F%201/roster/ownership%20%2F%201/release',
      method: 'POST', headers: { 'Idempotency-Key': 'release-key' },
      data: { seasonId: 'season-1', transferWindowId: 'window-1', ownershipId: 'ownership / 1', expectedVersion: 4, reason: '为新球员腾出阵容名额' },
    })
  })

  it('uses separate read-only paths for the public team directory and assets', async () => {
    const request = vi.spyOn(api, 'request').mockResolvedValue({})
    await leagueTeamsApi.directory('league / 1')
    await economyApi.publicAssets('league / 1', 'team / 2')
    expect(request).toHaveBeenNthCalledWith(1, { path: '/me/leagues/league%20%2F%201/teams' })
    expect(request).toHaveBeenNthCalledWith(2, { path: '/me/leagues/league%20%2F%201/teams/team%20%2F%202/public-assets' })
  })
})
