export const PLAYER_AUCTION_COMMAND_HANDLER = Symbol('PLAYER_AUCTION_COMMAND_HANDLER');

export interface PlayerAuctionCommandHook {
  handle(inboundId: string): Promise<boolean>;
}
