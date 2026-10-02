import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateManualFinanceEntryRequest,
  FinanceLedgerEntry,
  TeamFinanceSummary
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from '../leagues/league.errors.js';

@Injectable()
export class TeamFinanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async createManualEntry(
    adminId: string,
    leagueId: string,
    input: CreateManualFinanceEntryRequest,
    key: string
  ): Promise<FinanceLedgerEntry> {
    await this.authorization.requireLeagueManager(adminId, leagueId);
    return this.receipts.execute(adminId, `finance-entry.create:${leagueId}`, key, async (tx) => {
      const team = await tx.leagueTeam.findFirst({
        where: { id: input.leagueTeamId, leagueId }, select: { id: true }
      });
      if (!team) throw this.error('LEAGUE_TEAM_NOT_FOUND', '球队不存在或不属于当前联赛', 404);
      if (input.seasonId) {
        const season = await tx.leagueSeason.findFirst({
          where: { id: input.seasonId, leagueId }, select: { id: true }
        });
        if (!season) throw this.error('LEAGUE_SEASON_NOT_FOUND', '赛季不存在或不属于当前联赛', 404);
      }
      const created = await tx.financeLedgerEntry.create({
        data: {
          leagueId,
          leagueTeamId: input.leagueTeamId,
          seasonId: input.seasonId,
          rosterTransactionId: null,
          direction: input.direction,
          type: input.type,
          amountMinor: input.amountMinor,
          note: input.note
        }
      });
      await this.audit.record(tx, {
        actorAdminId: adminId,
        leagueId,
        action: 'FINANCE_MANUAL_ENTRY_CREATED',
        resourceType: 'FINANCE_LEDGER_ENTRY',
        resourceId: created.id,
        reason: input.reason,
        metadata: {
          leagueTeamId: input.leagueTeamId,
          seasonId: input.seasonId,
          direction: input.direction,
          type: input.type,
          amountMinor: input.amountMinor
        }
      });
      return this.present(created);
    }, input);
  }

  async getSeasonSummary(
    userId: string,
    teamId: string,
    seasonId: string | null
  ): Promise<TeamFinanceSummary> {
    const team = await this.prisma.leagueTeam.findUnique({ where: { id: teamId } });
    if (!team) throw this.error('LEAGUE_TEAM_NOT_FOUND', '球队不存在', 404);
    if (team.ownerUserId !== userId) {
      throw this.error('TEAM_FINANCE_OWNER_REQUIRED', '只有球队拥有者可以查看球队财务', 403);
    }
    const participation = await this.prisma.seasonEntry.findFirst({
      where: { leagueTeamId: teamId, ownerUserId: userId, status: 'APPROVED' }, select: { id: true }
    });
    if (!participation) throw this.error('TEAM_FINANCE_SEASON_ENTRY_REQUIRED', '球队尚未获得联赛参赛资格', 403);
    if (seasonId) {
      const season = await this.prisma.leagueSeason.findFirst({
        where: { id: seasonId, leagueId: team.leagueId }, select: { id: true }
      });
      if (!season) throw this.error('LEAGUE_SEASON_NOT_FOUND', '赛季不存在或不属于当前联赛', 404);
    }
    const entries = await this.prisma.financeLedgerEntry.findMany({
      where: { leagueTeamId: teamId, seasonId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    const creditTotalMinor = entries
      .filter(({ direction }) => direction === 'CREDIT')
      .reduce((total, entry) => total + entry.amountMinor, 0);
    const debitTotalMinor = entries
      .filter(({ direction }) => direction === 'DEBIT')
      .reduce((total, entry) => total + entry.amountMinor, 0);
    return {
      leagueId: team.leagueId,
      teamId,
      seasonId,
      creditTotalMinor,
      debitTotalMinor,
      balanceMinor: creditTotalMinor - debitTotalMinor,
      uncategorizedEntryCount: seasonId === null ? entries.length : 0,
      entries: entries.map((entry) => this.present(entry))
    };
  }

  private present(entry: {
    id: string; leagueId: string; leagueTeamId: string; seasonId: string | null;
    rosterTransactionId: string | null; direction: 'DEBIT' | 'CREDIT';
    type: FinanceLedgerEntry['type']; amountMinor: number; note: string; createdAt: Date;
  }): FinanceLedgerEntry {
    return { ...entry, createdAt: entry.createdAt.toISOString() };
  }

  private error(code: string, message: string, status: number) {
    return new LeagueError(code, message, status);
  }
}
