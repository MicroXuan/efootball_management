import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { LeagueRosterError } from './league-roster.errors.js';

@Injectable()
export class TeamSalaryCapService {
  async requireWithClient(tx: Prisma.TransactionClient, teamId: string): Promise<number> {
    const team = await tx.leagueTeam.findUnique({
      where: { id: teamId },
      select: { salaryCapMinor: true }
    });
    if (team?.salaryCapMinor == null) {
      throw new LeagueRosterError(
        'TEAM_SALARY_CAP_UNSET',
        'An administrator must set this team salary cap before adding players',
        409,
        { teamId }
      );
    }
    return team.salaryCapMinor;
  }
}
