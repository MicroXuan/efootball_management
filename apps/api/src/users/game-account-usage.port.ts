import { Injectable } from '@nestjs/common';

export const GAME_ACCOUNT_USAGE_PORT = Symbol('GAME_ACCOUNT_USAGE_PORT');

export interface GameAccountUsagePort {
  /** Includes active competition registrations, team defaults, and live season entries. */
  hasActiveReferences(accountId: string): Promise<boolean>;
}

@Injectable()
export class NoActiveGameAccountUsage implements GameAccountUsagePort {
  async hasActiveReferences(accountId: string): Promise<boolean> {
    void accountId;
    return false;
  }
}
