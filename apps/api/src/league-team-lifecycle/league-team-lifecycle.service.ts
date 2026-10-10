import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { LeagueError } from '../leagues/league.errors.js';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class LeagueTeamLifecycleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LeagueVisibilityService) private readonly visibility: LeagueVisibilityService
  ) {}

  async requireActive(teamId: string, transaction?: Prisma.TransactionClient): Promise<string> {
    const leagueId = await this.visibility.requireVisible({ type: 'TEAM', id: teamId }, transaction);
    const client: DatabaseClient = transaction ?? this.prisma;
    const team = await client.leagueTeam.findUnique({
      where: { id: teamId },
      select: { status: true }
    });
    if (!team || !leagueId) throw this.visibility.notFound();
    if (team.status === 'ARCHIVED') {
      throw new LeagueError('TEAM_ARCHIVED', 'League team has withdrawn', 409);
    }
    if (team.status !== 'ACTIVE') {
      throw new LeagueError('LEAGUE_TEAM_NOT_ACTIVE', 'League team is not active', 409);
    }
    return leagueId;
  }
}
