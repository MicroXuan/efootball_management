import { Inject, Injectable } from '@nestjs/common';
import type { SeasonRosterReadinessResponse } from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { CompetitionError } from './competition.errors.js';

type Client = PrismaService | Prisma.TransactionClient;

@Injectable()
export class SeasonRosterReadinessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async evaluate(client: Client, seasonId: string, lockTeams = false): Promise<SeasonRosterReadinessResponse> {
    const season = await client.leagueSeason.findUnique({
      where: { id: seasonId }, select: { leagueId: true }
    });
    if (!season) throw new CompetitionError('SEASON_NOT_FOUND', '赛季不存在', 404);
    const entries = await client.seasonEntry.findMany({
      where: { seasonId, status: 'APPROVED', leagueTeam: { status: 'ACTIVE' } },
      select: {
        leagueTeamId: true,
        leagueTeam: { select: { id: true, name: true, teamNumber: true, salaryCapMinor: true } }
      },
      orderBy: [{ leagueTeam: { teamNumber: 'asc' } }, { leagueTeamId: 'asc' }]
    });
    const teamIds = [...new Set(entries.map((entry) => entry.leagueTeamId))];
    if (lockTeams && teamIds.length) {
      await (client as Prisma.TransactionClient).$queryRaw(Prisma.sql`
        SELECT id FROM league_teams WHERE id IN (${Prisma.join(teamIds)}) ORDER BY id FOR UPDATE
      `);
    }
    const ownerships = teamIds.length ? await client.leaguePlayerOwnership.findMany({
      where: { leagueId: season.leagueId, leagueTeamId: { in: teamIds }, status: 'ACTIVE' },
      select: { leagueTeamId: true, salaryMinor: true, currentPlayerCard: { select: { position: true } } }
    }) : [];
    const byTeam = new Map(teamIds.map((id) => [id, { playerCount: 0, goalkeeperCount: 0, salaryMinor: 0 }]));
    for (const ownership of ownerships) {
      const total = byTeam.get(ownership.leagueTeamId);
      if (!total) continue;
      total.playerCount += 1;
      total.goalkeeperCount += ownership.currentPlayerCard.position === 'GK' ? 1 : 0;
      total.salaryMinor += ownership.salaryMinor;
    }
    const teams = entries.map((entry) => {
      const total = byTeam.get(entry.leagueTeamId)!;
      const salaryCapMinor = entry.leagueTeam.salaryCapMinor;
      const issues: SeasonRosterReadinessResponse['teams'][number]['issues'] = [];
      if (total.playerCount < 16) issues.push('UNDER_MINIMUM');
      if (total.playerCount > 25) issues.push('OVER_MAXIMUM');
      if (total.goalkeeperCount < 1) issues.push('NO_GOALKEEPER');
      if (salaryCapMinor === null) issues.push('SALARY_CAP_UNSET');
      else if (total.salaryMinor > salaryCapMinor) issues.push('OVER_CAP');
      return {
        leagueTeamId: entry.leagueTeamId,
        teamName: entry.leagueTeam.name,
        teamNumber: entry.leagueTeam.teamNumber,
        ...total,
        salaryCapMinor,
        issues
      };
    });
    return { seasonId, ready: teams.length > 0 && teams.every((team) => team.issues.length === 0), teams };
  }

  preview(seasonId: string) {
    return this.evaluate(this.prisma, seasonId);
  }

  async assertReady(client: Prisma.TransactionClient, seasonId: string): Promise<void> {
    const result = await this.evaluate(client, seasonId, true);
    if (!result.ready) {
      throw new CompetitionError('SEASON_ROSTER_NOT_READY', '参赛球队阵容未达到开赛要求', 409, result);
    }
  }
}
