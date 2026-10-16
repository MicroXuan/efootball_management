import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class PlayerMarketLockRepository {
  // Global player-market order: season -> player/ownership -> sorted teams -> sorted applications.
  // Writers may omit resources they never touch, but must never acquire an earlier class later.
  async lockSeason(tx: Prisma.TransactionClient, seasonId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`);
  }

  async lockPlayer(tx: Prisma.TransactionClient, leagueId: string, footballPlayerId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM football_players WHERE id = ${footballPlayerId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM league_player_ownerships
      WHERE league_id = ${leagueId} AND football_player_id = ${footballPlayerId} FOR UPDATE`);
  }

  async lockTeam(tx: Prisma.TransactionClient, leagueTeamId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM league_teams WHERE id = ${leagueTeamId} FOR UPDATE`);
  }

  async lockTeams(tx: Prisma.TransactionClient, leagueTeamIds: Array<string | null | undefined>): Promise<void> {
    for (const leagueTeamId of [...new Set(leagueTeamIds.filter((id): id is string => Boolean(id)))].sort()) {
      await this.lockTeam(tx, leagueTeamId);
    }
  }

  async lockApplication(tx: Prisma.TransactionClient, applicationId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM player_acquisition_applications WHERE id = ${applicationId} FOR UPDATE`);
  }

  async lockApplicationsForPlayer(
    tx: Prisma.TransactionClient,
    leagueId: string,
    seasonId: string,
    footballPlayerId: string
  ): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM player_acquisition_applications
      WHERE league_id = ${leagueId} AND season_id = ${seasonId} AND football_player_id = ${footballPlayerId}
      ORDER BY id ASC FOR UPDATE`);
  }
}
