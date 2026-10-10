import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from '../leagues/league.errors.js';

export type LeagueOwnedResource =
  | { type: 'LEAGUE'; id: string }
  | { type: 'SEASON'; id: string }
  | { type: 'TEAM'; id: string }
  | { type: 'COMPETITION'; id: string }
  | { type: 'STAGE'; id: string }
  | { type: 'MATCH'; id: string }
  | { type: 'TRANSFER_WINDOW'; id: string }
  | { type: 'VALUATION_WINDOW'; id: string }
  | { type: 'VALUATION_SUBMISSION'; id: string }
  | { type: 'OWNERSHIP'; id: string };

type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class LeagueVisibilityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async requireVisible(
    resource: LeagueOwnedResource,
    transaction?: Prisma.TransactionClient
  ): Promise<string | null> {
    const client: DatabaseClient = transaction ?? this.prisma;
    switch (resource.type) {
      case 'LEAGUE': {
        const league = await client.league.findFirst({
          where: { id: resource.id, isDeleted: false },
          select: { id: true }
        });
        if (!league) throw this.notFound();
        return league.id;
      }
      case 'SEASON': {
        const season = await client.leagueSeason.findFirst({
          where: { id: resource.id, league: { isDeleted: false } },
          select: { leagueId: true }
        });
        if (!season) throw this.notFound();
        return season.leagueId;
      }
      case 'TEAM': {
        const team = await client.leagueTeam.findFirst({
          where: { id: resource.id, league: { isDeleted: false } },
          select: { leagueId: true }
        });
        if (!team) throw this.notFound();
        return team.leagueId;
      }
      case 'COMPETITION': {
        const competition = await client.competition.findUnique({
          where: { id: resource.id },
          select: { season: { select: { league: { select: { id: true, isDeleted: true } } } } }
        });
        if (!competition) throw this.notFound();
        if (!competition.season) return null;
        if (competition.season.league.isDeleted) throw this.notFound();
        return competition.season.league.id;
      }
      case 'STAGE': {
        const stage = await client.competitionStage.findUnique({
          where: { id: resource.id },
          select: {
            competition: {
              select: { season: { select: { league: { select: { id: true, isDeleted: true } } } } }
            }
          }
        });
        if (!stage) throw this.notFound();
        if (!stage.competition.season) return null;
        if (stage.competition.season.league.isDeleted) throw this.notFound();
        return stage.competition.season.league.id;
      }
      case 'MATCH': {
        const match = await client.competitionMatch.findUnique({
          where: { id: resource.id },
          select: {
            stage: {
              select: {
                competition: {
                  select: { season: { select: { league: { select: { id: true, isDeleted: true } } } } }
                }
              }
            }
          }
        });
        if (!match) throw this.notFound();
        if (!match.stage.competition.season) return null;
        if (match.stage.competition.season.league.isDeleted) throw this.notFound();
        return match.stage.competition.season.league.id;
      }
      case 'TRANSFER_WINDOW': {
        const window = await client.transferWindow.findFirst({
          where: { id: resource.id, season: { league: { isDeleted: false } } },
          select: { season: { select: { leagueId: true } } }
        });
        if (!window) throw this.notFound();
        return window.season.leagueId;
      }
      case 'VALUATION_WINDOW': {
        const window = await client.valuationWindow.findFirst({
          where: { id: resource.id, season: { league: { isDeleted: false } } },
          select: { season: { select: { leagueId: true } } }
        });
        if (!window) throw this.notFound();
        return window.season.leagueId;
      }
      case 'VALUATION_SUBMISSION': {
        const submission = await client.valuationSubmission.findFirst({
          where: { id: resource.id, window: { season: { league: { isDeleted: false } } } },
          select: { window: { select: { season: { select: { leagueId: true } } } } }
        });
        if (!submission) throw this.notFound();
        return submission.window.season.leagueId;
      }
      case 'OWNERSHIP': {
        const ownership = await client.leaguePlayerOwnership.findFirst({
          where: { id: resource.id, league: { isDeleted: false } },
          select: { leagueId: true }
        });
        if (!ownership) throw this.notFound();
        return ownership.leagueId;
      }
    }
  }

  notFound(): LeagueError {
    return new LeagueError('LEAGUE_NOT_FOUND', 'League was not found', 404);
  }
}
