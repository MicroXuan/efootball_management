export const PLAYER_AUCTION_RECOVERY_HOOK = Symbol('PLAYER_AUCTION_RECOVERY_HOOK');

export interface PlayerAuctionRecoveryHook {
  onBridgeUnavailable(deviceId: string, reason: string): Promise<number>;
  bridgeAvailable(deviceId: string): void;
}
