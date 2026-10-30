import { PlayerAuctionError } from './player-auction.errors.js';

export const AUCTION_PAUSE_TIMEOUT_MS = 60 * 60 * 1_000;

export function assertAuctionPauseNotExpired(batch: { pausedAt?: Date | null }, now: Date): void {
  if (batch.pausedAt && now.getTime() - batch.pausedAt.getTime() >= AUCTION_PAUSE_TIMEOUT_MS) {
    throw new PlayerAuctionError('AUCTION_PAUSE_EXPIRED', '拍卖已连续暂停满1小时，不能恢复，系统将自动取消未结束拍品。', 409);
  }
}
