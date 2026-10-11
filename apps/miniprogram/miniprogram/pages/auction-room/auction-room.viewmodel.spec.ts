import { describe, expect, it } from 'vitest'
import type { MyPlayerAuctionRoom, PlayerAuctionBidResult } from '@efm/contracts'
import {
  applyRoomSnapshot,
  bidFeedback,
  countdownCue,
  countdownSeconds,
  minimumPriceShortcuts,
  projectAuctionQueue,
  reconnectState,
  roomShare,
  shouldResyncRoom,
} from './auction-room.viewmodel'

const lot = (overrides: Partial<NonNullable<MyPlayerAuctionRoom['currentLot']>> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  displayOrder: 1,
  playerName: '车范根',
  playerSnapshot: {},
  startingPrice: 50,
  minimumIncrement: 10,
  status: 'ACTIVE' as const,
  currentPrice: 110,
  deadlineAt: '2026-10-10T12:00:30.000Z',
  deadlineEpoch: 4,
  bids: [],
  ...overrides,
})

const room = (overrides: Partial<MyPlayerAuctionRoom> = {}): MyPlayerAuctionRoom => ({
  batchId: '22222222-2222-4222-8222-222222222222',
  name: '十月拍卖',
  status: 'ACTIVE',
  bidChannel: 'MINIPROGRAM',
  serverNow: '2026-10-10T12:00:00.000Z',
  league: { id: '33333333-3333-4333-8333-333333333333', name: 'CELL 联赛' },
  team: { id: '44444444-4444-4444-8444-444444444444', name: '上海申花' },
  canBid: true,
  minimumValidPrice: 120,
  currentLot: lot(),
  queue: [],
  sharePath: '/pages/auction-room/index?batchId=22222222-2222-4222-8222-222222222222',
  ...overrides,
})

const queueLot = (overrides: Partial<NonNullable<MyPlayerAuctionRoom['currentLot']>>) => {
  const { bids, ...summary } = lot(overrides)
  void bids
  return summary
}

describe('auction room view model', () => {
  it('calibrates against server time, never goes negative, and hides a paused countdown', () => {
    const snapshot = applyRoomSnapshot(undefined, room(), Date.parse('2026-10-10T12:00:03.000Z'))
    expect(snapshot.serverOffsetMs).toBe(-3_000)
    expect(countdownSeconds(snapshot.room, Date.parse('2026-10-10T12:00:03.000Z'), snapshot.serverOffsetMs)).toBe(30)
    expect(countdownSeconds(snapshot.room, Date.parse('2026-10-10T12:00:34.000Z'), snapshot.serverOffsetMs)).toBe(0)
    expect(countdownSeconds(room({ status: 'PAUSED', currentLot: lot({ status: 'PAUSED', deadlineAt: null }) }), Date.now(), 0)).toBeNull()
  })

  it.each([30, 20, 10, 3, 2, 1, 0])('exposes the %s-second countdown state', (seconds) => {
    expect(countdownCue(seconds)).toEqual({ seconds, urgent: seconds <= 3 })
  })

  it('replaces stale bid input when the lot or epoch changes and resyncs on foreground return', () => {
    const previous = { ...applyRoomSnapshot(undefined, room(), Date.parse('2026-10-10T12:00:03.000Z')), draftAmount: '130' }
    const changed = applyRoomSnapshot(previous, room({ currentLot: lot({ deadlineEpoch: 5 }) }), Date.parse('2026-10-10T12:00:04.000Z'))
    expect(changed.draftAmount).toBe('')
    expect(shouldResyncRoom('show')).toBe(true)
    expect(shouldResyncRoom('tick')).toBe(false)
  })

  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 5_000],
    [8, 5_000],
  ])('backs off reconnect attempt %s for %sms', (attempt, retryAfterMs) => {
    expect(reconnectState(attempt)).toEqual({ label: '正在重新连接', retryAfterMs, canBid: false })
  })

  it('formats valid and rejected bid feedback without trusting client identity or time', () => {
    expect(bidFeedback('VALID', { teamName: '上海申花', amount: 120 })).toBe('【上海申花】出价有效：⭐120⭐，倒计时重置为 30 秒。')
    expect(bidFeedback('BELOW_MINIMUM_INCREMENT', { requiredMinimum: 130 })).toBe('当前最低有效价为 ⭐130⭐。')
    expect(bidFeedback('DEADLINE_PASSED')).toBe('该球员拍卖已结束，正在刷新下一位。')
    expect(bidFeedback('AUCTION_EPOCH_CHANGED' as PlayerAuctionBidResult)).toBe('拍卖状态已变化，正在刷新。')
    expect(bidFeedback('NO_ACTIVE_TEAM')).toBe('你在当前联赛没有有效球队，无法出价。')
  })

  it('builds minimum-price shortcuts and native share metadata', () => {
    expect(minimumPriceShortcuts(120, 10)).toEqual([120, 130, 140])
    expect(roomShare(room())).toEqual({ title: '十月拍卖 · CELL 联赛', path: '/pages/auction-room/index?batchId=22222222-2222-4222-8222-222222222222' })
  })

  it('separates upcoming lots from closed results', () => {
    const queue = [
      queueLot({ id: '55555555-5555-4555-8555-555555555555', status: 'QUEUED' }),
      queueLot({ id: '66666666-6666-4666-8666-666666666666', status: 'PENDING_REVIEW' }),
      queueLot({ id: '77777777-7777-4777-8777-777777777777', status: 'NO_BID' }),
    ]
    expect(projectAuctionQueue(queue)).toEqual({
      upcoming: [queue[0]],
      completed: [queue[1], queue[2]],
    })
  })
})
