import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { LeagueRosterError } from './league-roster.errors.js';

@Injectable()
export class TeamSalaryCapService {
  async readWithClient(tx: Prisma.TransactionClient, teamId: string): Promise<number | null> {
    const team = await tx.leagueTeam.findUnique({
      where: { id: teamId },
      select: { salaryCapMinor: true }
    });
    return team?.salaryCapMinor ?? null;
  }

  async requireWithClient(tx: Prisma.TransactionClient, teamId: string): Promise<number> {
    const salaryCapMinor = await this.readWithClient(tx, teamId);
    if (salaryCapMinor === null) {
      throw new LeagueRosterError(
        'TEAM_SALARY_CAP_UNSET',
        'An administrator must set this team salary cap before adding players',
        409,
        { teamId }
      );
    }
    return salaryCapMinor;
  }
}
