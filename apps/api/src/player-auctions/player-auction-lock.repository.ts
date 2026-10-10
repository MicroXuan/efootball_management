import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class PlayerAuctionLockRepository {
  lockGroup(tx: Prisma.TransactionClient, groupBindingId: string) {
    return tx.$queryRaw`SELECT id FROM wechat_group_bindings WHERE id = ${groupBindingId} FOR UPDATE`;
  }

  lockBatch(tx: Prisma.TransactionClient, batchId: string) {
    return tx.$queryRaw`SELECT id FROM player_auction_batches WHERE id = ${batchId} FOR UPDATE`;
  }

  lockLot(tx: Prisma.TransactionClient, lotId: string) {
    return tx.$queryRaw`SELECT id FROM player_auction_lots WHERE id = ${lotId} FOR UPDATE`;
  }

  async now(tx: Prisma.TransactionClient): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ databaseNow: Date }>>`SELECT CURRENT_TIMESTAMP(3) AS databaseNow`;
    const value = rows[0]?.databaseNow;
    if (!value) throw new Error('DATABASE_TIME_UNAVAILABLE');
    return value;
  }
}
