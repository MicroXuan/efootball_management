import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class PlayerAuctionLockRepository {
  lockLeague(tx: Prisma.TransactionClient, leagueId: string) {
    return tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`;
  }

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
    // The DB session uses Beijing time; Prisma Date values are UTC instants.
    // Read UTC here so deadlines match the worker clock. UI renders Beijing time.
    const rows = await tx.$queryRaw<Array<{ databaseNow: Date }>>`SELECT UTC_TIMESTAMP(3) AS databaseNow`;
    const value = rows[0]?.databaseNow;
    if (!value) throw new Error('DATABASE_TIME_UNAVAILABLE');
    return value;
  }
}
