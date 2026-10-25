import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError } from './competition.errors.js';

@Injectable()
export class SeasonPlayingRosterService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async capture(transaction: Prisma.TransactionClient, seasonId: string): Promise<void> {
    const season = await transaction.leagueSeason.findUnique({
      where: { id: seasonId },
      select: { leagueId: true, playingRosterCapturedAt: true }
    });
    if (!season) throw new CompetitionError('SEASON_NOT_FOUND', '赛季不存在', 404);
    if (season.playingRosterCapturedAt) return;

    const entries = await transaction.seasonEntry.findMany({
      where: { seasonId, status: 'APPROVED', leagueTeam: { status: 'ACTIVE' } },
      select: { leagueTeamId: true }
    });
    const teamIds = entries.map((entry) => entry.leagueTeamId);
    const ownerships = teamIds.length ? await transaction.leaguePlayerOwnership.findMany({
      where: { leagueId: season.leagueId, leagueTeamId: { in: teamIds }, status: 'ACTIVE' },
      select: { leagueTeamId: true, footballPlayerId: true, currentPlayerCardId: true }
    }) : [];
    if (ownerships.length) {
      await transaction.seasonPlayingRosterEntry.createMany({
        data: ownerships.map((ownership) => ({
          seasonId,
          leagueTeamId: ownership.leagueTeamId,
          footballPlayerId: ownership.footballPlayerId,
          playerCardId: ownership.currentPlayerCardId
        }))
      });
    }
    await transaction.leagueSeason.update({
      where: { id: seasonId },
      data: { playingRosterCapturedAt: new Date() }
    });
  }

  async list(userId: string, seasonId: string, leagueTeamId?: string) {
    const season = await this.prisma.leagueSeason.findUnique({
      where: { id: seasonId },
      select: { leagueId: true, status: true, playingRosterCapturedAt: true, league: { select: { isDeleted: true } } }
    });
    if (!season || season.league.isDeleted) throw new CompetitionError('SEASON_NOT_FOUND', '赛季不存在', 404);
    const participant = await this.prisma.seasonEntry.findFirst({
      where: { seasonId, ownerUserId: userId, status: 'APPROVED' },
      select: { id: true }
    });
    if (!participant) throw new CompetitionError('PLAYING_ROSTER_ACCESS_DENIED', '仅本赛季参赛者可查看参赛名单', 403);
    if (!season.playingRosterCapturedAt) {
      throw new CompetitionError('PLAYING_ROSTER_NOT_CAPTURED', '该赛季尚无已确认的参赛名单', 409);
    }
    const rows = await this.prisma.seasonPlayingRosterEntry.findMany({
      where: { seasonId, ...(leagueTeamId ? { leagueTeamId } : {}) },
      select: {
        leagueTeamId: true,
        footballPlayerId: true,
        playerCardId: true,
        footballPlayer: { select: { nameZh: true, nameEn: true } },
        playerCard: { select: { cardName: true, position: true, overallRating: true } }
      },
      orderBy: [{ leagueTeamId: 'asc' }, { footballPlayerId: 'asc' }]
    });
    return {
      seasonId,
      capturedAt: season.playingRosterCapturedAt.toISOString(),
      items: rows.map((row) => ({
        leagueTeamId: row.leagueTeamId,
        footballPlayerId: row.footballPlayerId,
        playerCardId: row.playerCardId,
        playerName: row.footballPlayer.nameZh ?? row.footballPlayer.nameEn ?? '',
        cardName: row.playerCard.cardName,
        position: row.playerCard.position,
        overallRating: row.playerCard.overallRating
      }))
    };
  }
}
