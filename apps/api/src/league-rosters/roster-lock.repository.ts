import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class RosterLockRepository {
  async lockTeam(client: Prisma.TransactionClient, leagueTeamId: string) {
    await client.$queryRaw(
      Prisma.sql`SELECT id FROM league_teams WHERE id = ${leagueTeamId} FOR UPDATE`
    );
  }

  async lockOwnership(
    client: Prisma.TransactionClient,
    leagueId: string,
    footballPlayerId: string
  ) {
    await client.$queryRaw(
      Prisma.sql`SELECT id FROM league_player_ownerships
        WHERE league_id = ${leagueId} AND football_player_id = ${footballPlayerId}
        FOR UPDATE`
    );
  }
}
