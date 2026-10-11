import { describe, expect, it } from 'vitest'
import type { MyPlayerAuctionListItem } from '@efm/contracts'
import { groupAuctionsByLeague, playerAuctionStatusLabel } from './player-auctions.viewmodel'

const item = (batchId: string, leagueId: string, leagueName: string): MyPlayerAuctionListItem => ({
  batchId,
  league: { id: leagueId, name: leagueName },
  team: { id: `${batchId}-team`, name: `${leagueName}球队` },
  name: `${leagueName}拍卖`,
  status: 'ACTIVE',
  currentLotId: null,
  currentPlayerName: null,
  deadlineAt: null,
  sharePath: `/pages/auction-room/index?batchId=${batchId}`,
})

describe('player auctions view model', () => {
  it('groups active auctions by league id without merging leagues with the same name', () => {
    const groups = groupAuctionsByLeague([
      item('batch-a', 'league-a', '周末联赛'),
      item('batch-b', 'league-b', '周末联赛'),
      item('batch-c', 'league-a', '周末联赛'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]?.leagueId).toBe('league-a')
    expect(groups[0]?.items.map((auction) => auction.batchId)).toEqual(['batch-a', 'batch-c'])
    expect(groups[1]?.leagueId).toBe('league-b')
  })

  it.each([
    ['READY', '等待开始'],
    ['ACTIVE', '拍卖中'],
    ['PAUSED', '已暂停'],
    ['COMPLETED', '已结束'],
    ['CANCELLED', '已取消'],
    ['RECOVERY_REQUIRED', '等待恢复'],
  ] as const)('maps %s to %s', (status, label) => {
    expect(playerAuctionStatusLabel(status)).toBe(label)
  })
})
