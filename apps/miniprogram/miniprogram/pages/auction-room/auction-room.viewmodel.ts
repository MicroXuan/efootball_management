import type {
  MyPlayerAuctionRoom,
  PlayerAuctionBidResult,
} from '@efm/contracts'

export type RoomSnapshot = {
  room: MyPlayerAuctionRoom
  serverOffsetMs: number
  draftAmount: string
}

export function applyRoomSnapshot(
  previous: RoomSnapshot | undefined,
  room: MyPlayerAuctionRoom,
  receivedAtMs: number,
): RoomSnapshot {
  const priorLot = previous?.room.currentLot
  const currentLot = room.currentLot
  const sameAuctionMoment = priorLot?.id === currentLot?.id
    && priorLot?.deadlineEpoch === currentLot?.deadlineEpoch
  return {
    room,
    serverOffsetMs: Date.parse(room.serverNow) - receivedAtMs,
    draftAmount: sameAuctionMoment ? previous?.draftAmount ?? '' : '',
  }
}

export function countdownSeconds(
  room: MyPlayerAuctionRoom,
  clientNowMs: number,
  serverOffsetMs: number,
): number | null {
  if (room.status !== 'ACTIVE' || room.currentLot?.status !== 'ACTIVE' || !room.currentLot.deadlineAt) return null
  const remainingMs = Date.parse(room.currentLot.deadlineAt) - (clientNowMs + serverOffsetMs)
  return Math.max(0, Math.ceil(remainingMs / 1_000))
}

export function countdownCue(seconds: number) {
  return { seconds: Math.max(0, seconds), urgent: seconds <= 3 }
}

export function shouldResyncRoom(event: 'show' | 'tick') {
  return event === 'show'
}

export function reconnectState(attempt: number) {
  const retryAfterMs = attempt <= 1 ? 1_000 : attempt === 2 ? 2_000 : 5_000
  return { label: '正在重新连接', retryAfterMs, canBid: false }
}

type BidFeedbackDetails = {
  teamName?: string | null
  amount?: number
  requiredMinimum?: number
}

export function bidFeedback(result: PlayerAuctionBidResult | 'AUCTION_EPOCH_CHANGED' | string, details: BidFeedbackDetails = {}) {
  if (result === 'VALID' && details.teamName && details.amount) {
    return `【${details.teamName}】出价有效：⭐${details.amount}⭐，倒计时重置为 30 秒。`
  }
  if ((result === 'BELOW_STARTING_PRICE' || result === 'BELOW_MINIMUM_INCREMENT') && details.requiredMinimum) {
    return `当前最低有效价为 ⭐${details.requiredMinimum}⭐。`
  }
  const messages: Record<Exclude<PlayerAuctionBidResult, 'VALID' | 'BELOW_STARTING_PRICE' | 'BELOW_MINIMUM_INCREMENT'> | 'AUCTION_EPOCH_CHANGED', string> = {
    AUCTION_EPOCH_CHANGED: '拍卖状态已变化，正在刷新。',
    DEADLINE_PASSED: '该球员拍卖已结束，正在刷新下一位。',
    NO_ACTIVE_TEAM: '你在当前联赛没有有效球队，无法出价。',
    WRONG_LEAGUE: '你的球队不属于当前联赛，无法出价。',
    PAUSED: '拍卖已暂停。',
    INACTIVE: '拍卖尚未开始或已经结束。',
    RECOVERY_REQUIRED: '拍卖正在恢复，请稍后重试。',
    UNBOUND: '当前身份尚未绑定球队。',
    DUPLICATE: '该出价已处理，请刷新查看。',
    OVERFLOW: '请输入有效的正整数价格。',
  }
  if (result === 'VALID') return '出价已受理，正在刷新。'
  if (result === 'BELOW_STARTING_PRICE' || result === 'BELOW_MINIMUM_INCREMENT') return '出价未达到最低有效价。'
  return messages[result as keyof typeof messages] ?? '出价未完成，请刷新状态后重试。'
}

export function minimumPriceShortcuts(minimum: number | null, increment: number): Array<{ amount: number; label: string }> {
  if (minimum === null) return []
  return [
    { amount: minimum, label: '最低价' },
    { amount: minimum + increment, label: '加 1 档' },
    { amount: minimum + increment * 2, label: '加 2 档' },
  ]
}

export function bidDraftState(amount: string, minimum: number | null) {
  if (!amount) return { valid: false, hint: '请选择快捷价格或输入整数金额' }
  const numericAmount = Number(amount)
  if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) {
    return { valid: false, hint: '请输入有效的正整数价格' }
  }
  if (minimum === null) return { valid: false, hint: '最低有效价暂不可用，请等待刷新' }
  if (numericAmount < minimum) return { valid: false, hint: `不得低于最低有效价 ⭐${minimum}⭐` }
  return { valid: true, hint: `本次将出价 ⭐${numericAmount}⭐` }
}

export function projectAuctionQueue(queue: MyPlayerAuctionRoom['queue']) {
  const upcoming = queue.filter((lot) => lot.status === 'QUEUED')
  const completed = queue.filter((lot) => ['PENDING_REVIEW', 'REVIEWED', 'VOID', 'NO_BID'].includes(lot.status))
  return { upcoming, completed }
}

export function roomShare(room: MyPlayerAuctionRoom) {
  return { title: `${room.name} · ${room.league.name}`, path: room.sharePath }
}

export function auctionRoomEntry(batchId: string, authenticated: boolean) {
  const roomPath = `/pages/auction-room/index?batchId=${encodeURIComponent(batchId)}`
  return authenticated ? roomPath : `/pages/login/index?redirect=${encodeURIComponent(roomPath)}`
}
