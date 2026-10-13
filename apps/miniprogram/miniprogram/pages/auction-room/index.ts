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
  projectAuctionQueue,
  reconnectState,
  roomShare,
  type RoomSnapshot,
} from './auction-room.viewmodel'

type LoadOptions = { batchId?: string }
type AmountInputEvent = { detail: { value: string } }
type ShortcutEvent = { currentTarget: { dataset: { amount?: number } } }

Page({
  pollTimer: undefined as ReturnType<typeof setTimeout> | undefined,
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
    upcoming: [] as MyPlayerAuctionRoom['queue'],
    completed: [] as MyPlayerAuctionRoom['queue'],
    canSubmit: false,
    amountHint: '请选择快捷价格或输入整数金额',
    submitting: false,
    feedback: '',
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
      wx.navigateTo({ url: '/pages/login/index?redirect=' + encodeURIComponent(roomPath) })
    }
  },

  onShow() {
    if (this.data.batchId && session.getAccessToken()) this.startPolling()
  },

  onHide() {
    this.stopPolling()
  },

  onUnload() {
    this.stopPolling()
  },

  startPolling() {
    this.stopPolling()
    void this.loadRoom()
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
      this.snapshot = applyRoomSnapshot(this.snapshot, room, Date.now())
      this.reconnectAttempts = 0
      this.renderRoom()
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
    const increment = room.currentLot?.minimumIncrement ?? 1
    const amount = this.snapshot.draftAmount
    const draft = bidDraftState(amount, room.minimumValidPrice)
    this.setData({
      state: 'loaded', room, teamName: room.team.name, reconnecting: false, statusMessage: '',
      countdown: countdown ?? '—', amount,
      shortcuts: minimumPriceShortcuts(room.minimumValidPrice, increment),
      upcoming: queue.upcoming, completed: queue.completed,
      canSubmit: room.canBid && !this.data.submitting && !this.data.reconnecting && draft.valid,
      amountHint: draft.hint,
    })
  },

  onAmountInput(event: AmountInputEvent) {
    const amount = event.detail.value.replace(/\D/g, '')
    if (this.snapshot) this.snapshot.draftAmount = amount
    const draft = bidDraftState(amount, this.snapshot?.room.minimumValidPrice ?? null)
    this.setData({ amount, amountHint: draft.hint, canSubmit: Boolean(this.snapshot?.room.canBid) && !this.data.reconnecting && !this.data.submitting && draft.valid })
  },

  useShortcut(event: ShortcutEvent) {
    const amount = event.currentTarget.dataset.amount
    if (!amount) return
    if (this.snapshot) this.snapshot.draftAmount = String(amount)
    const draft = bidDraftState(String(amount), this.snapshot?.room.minimumValidPrice ?? null)
    this.setData({ amount: String(amount), amountHint: draft.hint, canSubmit: Boolean(this.snapshot?.room.canBid) && !this.data.reconnecting && !this.data.submitting && draft.valid })
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
