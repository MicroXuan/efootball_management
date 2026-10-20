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
    return `【${details.teamName}】出价有效：${details.amount}，倒计时重置为 30 秒。`
  }
  if (result === 'BELOW_MINIMUM_INCREMENT' && details.requiredMinimum) {
    return `其他用户已先提交该价格，当前最低有效价为 ${details.requiredMinimum}。`
  }
  if (result === 'BELOW_STARTING_PRICE' && details.requiredMinimum) {
    return `当前最低有效价为 ${details.requiredMinimum}。`
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

export function minimumPriceShortcuts(minimum: number | null, _increment?: number): Array<{ amount: number; label: string }> {
  if (minimum === null) return []
  return [
    { amount: minimum, label: '最低价' },
    { amount: minimum + 10, label: '+10' },
    { amount: minimum + 50, label: '+50' },
    { amount: minimum + 100, label: '+100' },
  ]
}

export function bidDraftState(amount: string, minimum: number | null) {
  if (!amount) return { valid: false, hint: '请选择快捷价格或输入整数金额' }
  const numericAmount = Number(amount)
  if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) {
    return { valid: false, hint: '请输入有效的正整数价格' }
  }
  if (minimum === null) return { valid: false, hint: '最低有效价暂不可用，请等待刷新' }
  if (numericAmount < minimum) return { valid: false, hint: `不得低于最低有效价 ${minimum}` }
  return { valid: true, hint: `本次将出价 ${numericAmount}` }
}

export function playerCardDetailPath(cardId: string) {
  return `/pages/player-card-detail/index?id=${encodeURIComponent(cardId)}`
}

export function formatBidTime(value: string, offsetMinutes = -new Date().getTimezoneOffset()) {
  const shifted = new Date(Date.parse(value) + offsetMinutes * 60_000)
  return [shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds()]
    .map((part) => String(part).padStart(2, '0')).join(':')
}

export function publicBidRows(bids: NonNullable<MyPlayerAuctionRoom['currentLot']>['bids']) {
  return bids.map((bid) => ({
    ...bid,
    identity: `${bid.teamNumber === null ? '—' : bid.teamNumber}号 · ${bid.teamName} · ${bid.bidderDisplayName}`,
    timeLabel: formatBidTime(bid.submittedAt),
  }))
}

export function projectAuctionQueue(queue: MyPlayerAuctionRoom['queue']) {
  const upcoming = queue.filter((lot) => lot.status === 'QUEUED')
  const completed = queue.filter((lot) => ['PENDING_REVIEW', 'REVIEWED', 'VOID', 'NO_BID'].includes(lot.status)).map((lot) => ({
    ...lot,
    resultLabel: lot.status === 'VOID' ? '已作废' : lot.winner ? '已成交' : '流拍',
    winnerLabel: lot.winner ? `${lot.winner.teamNumber === null ? '—' : lot.winner.teamNumber}号 · ${lot.winner.teamName} · ${lot.winner.bidderDisplayName}` : '',
    priceLabel: lot.winner ? `${lot.winner.price} 资金` : '',
  }))
  return { upcoming, completed }
}

export function roomShare(room: MyPlayerAuctionRoom) {
  return { title: `${room.name} · ${room.league.name}`, path: room.sharePath }
}

export function auctionRoomEntry(batchId: string, authenticated: boolean) {
  const roomPath = `/pages/auction-room/index?batchId=${encodeURIComponent(batchId)}`
  return authenticated ? roomPath : `/pages/login/index?redirect=${encodeURIComponent(roomPath)}`
}
