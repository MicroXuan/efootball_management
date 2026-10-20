import type { MyPlayerAuctionRoom, PlayerAuctionBidResult } from '@efm/contracts'
import { ApiError } from '../../services/api'
import {
  createPlayerAuctionBidSubmission,
  getMyPlayerAuction,
  placeMyPlayerAuctionBid,
  type PlayerAuctionBidSubmission,
} from '../../services/player-auctions'
import { session } from '../../services/session'
import {
  applyRoomSnapshot,
  bidDraftState,
  bidFeedback,
  countdownSeconds,
  minimumPriceShortcuts,
  playerCardDetailPath,
  projectAuctionQueue,
  publicBidRows,
  reconnectState,
  roomShare,
  salePresentation,
  type RoomSnapshot,
} from './auction-room.viewmodel'

type LoadOptions = { batchId?: string }
type AmountInputEvent = { detail: { value: string } }
type ShortcutEvent = { currentTarget: { dataset: { amount?: number } } }

Page({
  pollTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  countdownTimer: undefined as ReturnType<typeof setInterval> | undefined,
  celebrationTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  snapshot: undefined as RoomSnapshot | undefined,
  pendingSubmission: undefined as PlayerAuctionBidSubmission | undefined,
  reconnectAttempts: 0,

  data: {
    state: 'loading' as 'loading' | 'loaded' | 'error',
    batchId: '',
    room: null as MyPlayerAuctionRoom | null,
    teamName: '',
    countdown: '—' as number | '—',
    statusMessage: '',
    reconnecting: false,
    reconnectLabel: '正在重新连接',
    amount: '',
    shortcuts: [] as Array<{ amount: number; label: string }>,
    bidRows: [] as ReturnType<typeof publicBidRows>,
    playerFallback: '球',
    upcoming: [] as MyPlayerAuctionRoom['queue'],
    completed: [] as ReturnType<typeof projectAuctionQueue>['completed'],
    canSubmit: false,
    amountHint: '请选择快捷价格或输入整数金额',
    submitting: false,
    feedback: '',
    sale: null as ReturnType<typeof salePresentation>['sale'],
    celebratingSaleId: '',
    settling: false,
    confettiPieces: Array.from({ length: 12 }, (_, index) => index),
  },

  onLoad(options: LoadOptions) {
    if (!options.batchId) {
      this.setData({ state: 'error', statusMessage: '拍卖参数缺失' })
      return
    }
    this.setData({ batchId: options.batchId })
    wx.showShareMenu({ menus: ['shareAppMessage'] })
    if (!session.getAccessToken()) {
      const roomPath = '/pages/auction-room/index?batchId=' + encodeURIComponent(options.batchId)
      wx.redirectTo({ url: '/pages/login/index?redirect=' + encodeURIComponent(roomPath) })
    }
  },

  onShow() {
    if (this.data.batchId && session.getAccessToken()) this.startPolling()
  },

  onHide() {
    this.stopPolling()
    this.stopClock()
    this.stopCelebration()
    this.snapshot = undefined
  },

  onUnload() {
    this.stopPolling()
    this.stopClock()
    this.stopCelebration()
  },

  stopCelebration() {
    if (this.celebrationTimer !== undefined) clearTimeout(this.celebrationTimer)
    this.celebrationTimer = undefined
    this.setData({ celebratingSaleId: '' })
  },

  startPolling() {
    this.stopPolling()
    this.startClock()
    void this.loadRoom()
  },

  startClock() {
    this.stopClock()
    this.countdownTimer = setInterval(() => this.tickCountdown(), 250)
  },

  stopClock() {
    if (this.countdownTimer !== undefined) clearInterval(this.countdownTimer)
    this.countdownTimer = undefined
  },

  tickCountdown() {
    if (!this.snapshot) return
    const countdown = countdownSeconds(this.snapshot.room, Date.now(), this.snapshot.serverOffsetMs)
    if (countdown === null) return
    const settling = countdown === 0
    if (this.data.countdown !== countdown || this.data.settling !== settling) {
      this.setData({ countdown, settling, ...(settling ? { canSubmit: false } : {}) })
    }
  },

  stopPolling() {
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    this.pollTimer = undefined
  },

  scheduleNext(delayMs: number) {
    this.stopPolling()
    this.pollTimer = setTimeout(() => void this.loadRoom(), delayMs)
  },

  async loadRoom() {
    try {
      const room = await getMyPlayerAuction(this.data.batchId)
      const presentation = salePresentation(this.snapshot?.room, room)
      this.snapshot = applyRoomSnapshot(this.snapshot, room, Date.now())
      this.reconnectAttempts = 0
      this.renderRoom()
      if (presentation.celebrate && presentation.sale) {
        this.stopCelebration()
        this.setData({ celebratingSaleId: presentation.sale.id })
        this.celebrationTimer = setTimeout(() => this.stopCelebration(), 3_600)
      }
      this.scheduleNext(1_000)
    } catch (error) {
      this.reconnectAttempts += 1
      const reconnect = reconnectState(this.reconnectAttempts)
      this.setData({ state: this.data.room ? 'loaded' : 'error', reconnecting: true, reconnectLabel: reconnect.label, canSubmit: false, statusMessage: error instanceof ApiError ? error.message : '拍卖连接失败' })
      this.scheduleNext(reconnect.retryAfterMs)
    }
  },

  renderRoom() {
    if (!this.snapshot) return
    const room = this.snapshot.room
    const countdown = countdownSeconds(room, Date.now(), this.snapshot.serverOffsetMs)
    const queue = projectAuctionQueue(room.queue)
    const amount = this.snapshot.draftAmount
    const draft = bidDraftState(amount, room.minimumValidPrice)
    const settling = countdown === 0
    this.setData({
      state: 'loaded', room, teamName: room.team?.name ?? '观战与分享', reconnecting: false, statusMessage: '',
      countdown: countdown ?? '—', amount,
      shortcuts: minimumPriceShortcuts(room.minimumValidPrice),
      bidRows: publicBidRows(room.currentLot?.bids ?? []),
      playerFallback: room.currentLot?.playerName.slice(0, 2) || '球',
      upcoming: queue.upcoming, completed: queue.completed,
      sale: salePresentation(undefined, room).sale, settling,
      canSubmit: room.canBid && !settling && !this.data.submitting && !this.data.reconnecting && draft.valid,
      amountHint: draft.hint,
    })
  },

  onAmountInput(event: AmountInputEvent) {
    const amount = event.detail.value.replace(/\D/g, '')
    if (this.snapshot) this.snapshot.draftAmount = amount
    const draft = bidDraftState(amount, this.snapshot?.room.minimumValidPrice ?? null)
    this.setData({ amount, amountHint: draft.hint, canSubmit: Boolean(this.snapshot?.room.canBid) && !this.data.settling && !this.data.reconnecting && !this.data.submitting && draft.valid })
  },

  useShortcut(event: ShortcutEvent) {
    const amount = event.currentTarget.dataset.amount
    if (!amount) return
    if (this.snapshot) this.snapshot.draftAmount = String(amount)
    const draft = bidDraftState(String(amount), this.snapshot?.room.minimumValidPrice ?? null)
    this.setData({ amount: String(amount), amountHint: draft.hint, canSubmit: Boolean(this.snapshot?.room.canBid) && !this.data.settling && !this.data.reconnecting && !this.data.submitting && draft.valid })
  },

  openPlayerCard() {
    const cardId = this.snapshot?.room.currentLot?.card.id
    if (cardId) wx.navigateTo({ url: playerCardDetailPath(cardId) })
  },

  openHome() {
    wx.switchTab({ url: '/pages/leagues/index' })
  },

  async submitBid() {
    const lot = this.snapshot?.room.currentLot
    const amount = Number(this.data.amount)
    if (!this.data.canSubmit || !lot || !Number.isSafeInteger(amount) || amount <= 0) return
    const input = { amount, lotId: lot.id, deadlineEpoch: lot.deadlineEpoch }
    const pending = this.pendingSubmission
    const submission = pending && pending.input.amount === input.amount && pending.input.lotId === input.lotId && pending.input.deadlineEpoch === input.deadlineEpoch
      ? pending
      : createPlayerAuctionBidSubmission(input)
    this.pendingSubmission = submission
    this.stopPolling()
    this.setData({ submitting: true, canSubmit: false, feedback: '' })
    try {
      const decision = await placeMyPlayerAuctionBid(this.data.batchId, submission.input, submission.idempotencyKey)
      this.pendingSubmission = undefined
      this.setData({ feedback: bidFeedback(decision.result, decision) })
      await this.loadRoom()
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'INACTIVE'
      this.setData({ feedback: bidFeedback(code as PlayerAuctionBidResult | 'AUCTION_EPOCH_CHANGED') })
      if (code === 'AUCTION_EPOCH_CHANGED' || code === 'DEADLINE_PASSED' || code === 'NO_ACTIVE_TEAM') {
        this.pendingSubmission = undefined
        await this.loadRoom()
      }
    } finally {
      this.setData({ submitting: false })
      this.renderRoom()
    }
  },

  onShareAppMessage() {
    return this.snapshot ? roomShare(this.snapshot.room) : { title: '球员拍卖', path: `/pages/auction-room/index?batchId=${encodeURIComponent(this.data.batchId)}` }
  },
})
