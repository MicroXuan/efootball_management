import { Inject, Injectable } from '@nestjs/common';
import type { PersonalFinanceEntry, PersonalFinanceEntryInput, PersonalFinanceList, PersonalFinanceUpdate } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from '../leagues/league.errors.js';

@Injectable()
export class PersonalFinanceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async scope(userId: string, teamId: string, seasonId: string) {
    const team = await this.prisma.leagueTeam.findFirst({
      where: { id: teamId, ownerUserId: userId }, select: { leagueId: true },
    });
    if (!team) throw new LeagueError('PERSONAL_FINANCE_FORBIDDEN', '只能查看自己的球队账本', 403);
    const season = await this.prisma.leagueSeason.findFirst({
      where: { id: seasonId, leagueId: team.leagueId }, select: { id: true },
    });
    if (!season) throw new LeagueError('LEAGUE_SEASON_NOT_FOUND', '赛季不属于当前联赛', 404);
    return { leagueId: team.leagueId };
  }

  private present(row: {
    id: string; seasonId: string; direction: 'DEBIT' | 'CREDIT'; amountMinor: number;
    title: string; note: string; occurredOn: Date; version: number; createdAt: Date; updatedAt: Date;
  }): PersonalFinanceEntry {
    return {
      id: row.id, seasonId: row.seasonId, direction: row.direction, amountMinor: row.amountMinor,
      title: row.title, note: row.note, occurredOn: row.occurredOn.toISOString().slice(0, 10),
      version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(userId: string, teamId: string, seasonId: string): Promise<PersonalFinanceList> {
    const { leagueId } = await this.scope(userId, teamId, seasonId);
    const rows = await this.prisma.personalFinanceEntry.findMany({
      where: { userId, leagueTeamId: teamId, seasonId },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    const creditTotalMinor = rows.filter((row) => row.direction === 'CREDIT').reduce((sum, row) => sum + row.amountMinor, 0);
    const debitTotalMinor = rows.filter((row) => row.direction === 'DEBIT').reduce((sum, row) => sum + row.amountMinor, 0);
    return { leagueId, teamId, seasonId, creditTotalMinor, debitTotalMinor,
      balanceMinor: creditTotalMinor - debitTotalMinor, items: rows.map((row) => this.present(row)) };
  }

  async create(userId: string, teamId: string, input: PersonalFinanceEntryInput): Promise<PersonalFinanceEntry> {
    const { leagueId } = await this.scope(userId, teamId, input.seasonId);
    const row = await this.prisma.personalFinanceEntry.create({ data: {
      userId, leagueId, leagueTeamId: teamId, seasonId: input.seasonId,
      direction: input.direction, amountMinor: input.amountMinor, title: input.title,
      note: input.note ?? '', occurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`),
    } });
    return this.present(row);
  }

  async update(userId: string, teamId: string, entryId: string, input: PersonalFinanceUpdate): Promise<PersonalFinanceEntry> {
    await this.scope(userId, teamId, input.seasonId);
    const changed = await this.prisma.personalFinanceEntry.updateMany({
      where: { id: entryId, userId, leagueTeamId: teamId, seasonId: input.seasonId, version: input.expectedVersion },
      data: { direction: input.direction, amountMinor: input.amountMinor, title: input.title,
        note: input.note ?? '', occurredOn: new Date(`${input.occurredOn}T00:00:00.000Z`), version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new LeagueError('PERSONAL_FINANCE_CONFLICT', '记录已变化，请刷新后重试', 409);
    const row = await this.prisma.personalFinanceEntry.findUniqueOrThrow({ where: { id: entryId } });
    return this.present(row);
  }

  async remove(userId: string, teamId: string, seasonId: string, entryId: string): Promise<{ deleted: true }> {
    await this.scope(userId, teamId, seasonId);
    const result = await this.prisma.personalFinanceEntry.deleteMany({
      where: { id: entryId, userId, leagueTeamId: teamId, seasonId },
    });
    if (!result.count) throw new LeagueError('PERSONAL_FINANCE_NOT_FOUND', '记录不存在', 404);
    return { deleted: true };
  }
}
