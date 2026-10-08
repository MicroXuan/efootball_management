import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

@Injectable()
export class TeamFinanceService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async createManualEntry(
    adminId: string,
    leagueId: string,
    input: CreateManualFinanceEntryRequest,
    key: string
  ): Promise<FinanceLedgerEntry> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const teamLeagueId = await this.visibility.requireVisible({ type: 'TEAM', id: input.leagueTeamId });
    if (teamLeagueId !== leagueId) throw this.visibility.notFound();
    if (input.seasonId) {
      const seasonLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: input.seasonId });
      if (seasonLeagueId !== leagueId) throw this.visibility.notFound();
    }
    await this.authorization.requireLeagueManager(adminId, leagueId);
    await this.requireActive(input.leagueTeamId);
    return this.receipts.execute(adminId, `finance-entry.create:${leagueId}`, key, async (tx) => {
      const team = await tx.leagueTeam.findFirst({
        where: { id: input.leagueTeamId, leagueId }, select: { id: true, status: true }
      });
      if (!team) throw this.error('LEAGUE_TEAM_NOT_FOUND', '球队不存在或不属于当前联赛', 404);
      if (team.status === 'ARCHIVED') throw this.error('TEAM_ARCHIVED', '球队已退出联赛', 409);
      if (team.status && team.status !== 'ACTIVE') throw this.error('LEAGUE_TEAM_NOT_ACTIVE', '球队当前不可操作', 409);
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
    const teamLeagueId = await this.visibility.requireVisible({ type: 'TEAM', id: teamId });
    if (seasonId) {
      const seasonLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
      if (seasonLeagueId !== teamLeagueId) throw this.visibility.notFound();
    }
    const team = await this.prisma.leagueTeam.findUnique({
      where: { id: teamId },
      include: { league: { select: { currentSeasonId: true } } }
    });
    if (!team) throw this.error('LEAGUE_TEAM_NOT_FOUND', '球队不存在', 404);
    if (team.ownerUserId !== userId) {
      throw this.error('TEAM_FINANCE_OWNER_REQUIRED', '只有球队拥有者可以查看球队财务', 403);
    }
    const participation = await this.prisma.seasonEntry.findFirst({
      where: { leagueTeamId: teamId, ownerUserId: userId, status: 'APPROVED' }, select: { id: true }
    });
    if (!participation) throw this.error('TEAM_FINANCE_SEASON_ENTRY_REQUIRED', '球队尚未获得联赛参赛资格', 403);
    const resolvedSeasonId = seasonId ?? team.league.currentSeasonId;
    if (resolvedSeasonId) {
      const season = await this.prisma.leagueSeason.findFirst({
        where: { id: resolvedSeasonId, leagueId: team.leagueId }, select: { id: true }
      });
      if (!season) throw this.error('LEAGUE_SEASON_NOT_FOUND', '赛季不存在或不属于当前联赛', 404);
    }
    const entries = await this.prisma.financeLedgerEntry.findMany({
      where: { leagueTeamId: teamId, seasonId: resolvedSeasonId },
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
      seasonId: resolvedSeasonId,
      creditTotalMinor,
      debitTotalMinor,
      balanceMinor: creditTotalMinor - debitTotalMinor,
      uncategorizedEntryCount: resolvedSeasonId === null ? entries.length : 0,
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

  private async requireActive(teamId: string): Promise<void> {
    const team = await this.prisma.leagueTeam.findUnique({ where: { id: teamId }, select: { status: true } });
    if (team?.status === 'ARCHIVED') throw this.error('TEAM_ARCHIVED', '球队已退出联赛', 409);
    if (team?.status && team.status !== 'ACTIVE') throw this.error('LEAGUE_TEAM_NOT_ACTIVE', '球队当前不可操作', 409);
  }

  private error(code: string, message: string, status: number) {
    return new LeagueError(code, message, status);
  }
}
