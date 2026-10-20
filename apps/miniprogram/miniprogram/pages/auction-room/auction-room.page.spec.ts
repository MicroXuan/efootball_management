import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyPlayerAuctionRoom } from '@efm/contracts'

const mocks = vi.hoisted(() => ({ getRoom: vi.fn() }))

vi.mock('../../services/player-auctions', () => ({ getMyPlayerAuction: mocks.getRoom }))
vi.mock('../../services/session', () => ({ session: { getAccessToken: () => 'test-token' } }))

type RoomPage = {
  data: Record<string, any>
  snapshot?: unknown
  celebrationTimer?: ReturnType<typeof setTimeout>
  loadRoom(): Promise<void>
  startPolling(): void
  stopClock(): void
  stopCelebration(): void
  scheduleNext(delayMs: number): void
  renderRoom(): void
}

let page: RoomPage

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: RoomPage) => { page = definition })
  await import('./index')
})

beforeEach(() => {
  vi.clearAllMocks()
})

const lotId = '11111111-1111-4111-8111-111111111111'

function room(closed = false): MyPlayerAuctionRoom {
  const now = new Date()
  const lot = {
    id: lotId, displayOrder: 1, playerName: '车范根', playerSnapshot: {},
    card: { id: '99999999-9999-4999-8999-999999999999', imageUrl: null, cardName: '史诗', position: 'CF' as const, overallRating: 96, cardType: 'EPIC' as const },
    startingPrice: 50, minimumIncrement: 10, status: closed ? 'PENDING_REVIEW' as const : 'ACTIVE' as const,
    currentPrice: 210, winner: closed ? { teamNumber: 1, teamName: '阿哈尔', bidderDisplayName: '小宣', price: 210 } : null,
    deadlineAt: now.toISOString(), deadlineEpoch: 1,
  }
  return {
    batchId: '22222222-2222-4222-8222-222222222222', name: '拍卖', status: 'ACTIVE', bidChannel: 'MINIPROGRAM',
    serverNow: now.toISOString(), league: { id: '33333333-3333-4333-8333-333333333333', name: '联赛' },
    team: { id: '44444444-4444-4444-8444-444444444444', name: '阿哈尔' }, canBid: !closed,
    minimumValidPrice: closed ? null : 220,
    currentLot: closed ? null : { ...lot, bids: [] },
    queue: closed ? [lot] : [], sharePath: '/pages/auction-room/index?batchId=22222222-2222-4222-8222-222222222222',
  }
}

function context() {
  const data: Record<string, any> = { ...page.data, batchId: '22222222-2222-4222-8222-222222222222' }
  return {
    ...page,
    data,
    setData(update: Record<string, unknown>) { Object.assign(this.data, update) },
    scheduleNext: vi.fn(),
  }
}

describe('auction room settlement presentation', () => {
  it('shows zero at the deadline without another room response', async () => {
    vi.useFakeTimers()
    try {
      const instance = context()
      const current = room()
      current.currentLot!.deadlineAt = new Date(Date.now() + 1_000).toISOString()
      mocks.getRoom.mockResolvedValueOnce(current)

      instance.startPolling()
      await Promise.resolve()
      expect(instance.data.countdown).toBe(1)
      vi.advanceTimersByTime(1_500)

      expect(instance.data.countdown).toBe(0)
      expect(instance.data.settling).toBe(true)
      expect(instance.data.canSubmit).toBe(false)
      instance.stopClock()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits at zero and celebrates once when the confirmed winner arrives', async () => {
    vi.useFakeTimers()
    try {
      const instance = context()
      mocks.getRoom.mockResolvedValueOnce(room()).mockResolvedValueOnce(room(true)).mockResolvedValueOnce(room(true))

      await instance.loadRoom()
      expect(instance.data.settling).toBe(true)
      expect(instance.data.canSubmit).toBe(false)
      expect(instance.data.sale).toBeNull()

      await instance.loadRoom()
      expect(instance.data.sale).toMatchObject({ playerName: '车范根', winnerLabel: '1号 · 阿哈尔 · 小宣', priceLabel: '210 资金' })
      expect(instance.data.celebratingSaleId).toBe(lotId)

      vi.advanceTimersByTime(3_600)
      expect(instance.data.celebratingSaleId).toBe('')
      await instance.loadRoom()
      expect(instance.data.sale?.id).toBe(lotId)
      expect(instance.data.celebratingSaleId).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })
})
