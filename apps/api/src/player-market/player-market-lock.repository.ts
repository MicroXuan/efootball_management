import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class PlayerMarketLockRepository {
  async lockPlayer(tx: Prisma.TransactionClient, leagueId: string, footballPlayerId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM football_players WHERE id = ${footballPlayerId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM league_player_ownerships
      WHERE league_id = ${leagueId} AND football_player_id = ${footballPlayerId} FOR UPDATE`);
  }

  async lockTeam(tx: Prisma.TransactionClient, leagueTeamId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM league_teams WHERE id = ${leagueTeamId} FOR UPDATE`);
  }

  async lockApplication(tx: Prisma.TransactionClient, applicationId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM player_acquisition_applications WHERE id = ${applicationId} FOR UPDATE`);
  }
}
