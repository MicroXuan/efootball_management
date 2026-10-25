import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  RecalculateLeagueSalaryRequestSchema,
  type RecalculateLeagueSalaryRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LeagueRosterError } from './league-roster.errors.js';
import { RosterLockRepository } from './roster-lock.repository.js';
import { salaryForOwnership } from './salary-rules.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { TeamSalaryCapService } from './team-salary-cap.service.js';

@Injectable()
export class SalaryRecalculationService {
  private readonly visibility: LeagueVisibilityService;
  private readonly teamSalaryCaps: TeamSalaryCapService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(RosterLockRepository) private readonly locks: RosterLockRepository,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService,
    @Optional() @Inject(TeamSalaryCapService) teamSalaryCaps?: TeamSalaryCapService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
    this.teamSalaryCaps = teamSalaryCaps ?? new TeamSalaryCapService();
  }

  async previewLeague(leagueId: string, seasonId: string, salaryRuleVersionId: string, adminId: string) {
    await this.requireScope(leagueId, seasonId, adminId);
    const calculation = await this.calculate(this.prisma, leagueId, seasonId, salaryRuleVersionId);
    return calculation.preview;
  }

  async recalculateLeague(
    raw: RecalculateLeagueSalaryRequest,
    adminId: string,
    at = new Date()
  ) {
    const input = RecalculateLeagueSalaryRequestSchema.parse(raw);
    await this.requireScope(input.leagueId, input.seasonId, adminId);

    return this.receipts.execute(adminId, 'ROSTER_SALARY_RECALCULATION', input.idempotencyKey,
      async (tx) => {
        const teams = await tx.leagueTeam.findMany({
          where: { leagueId: input.leagueId, status: 'ACTIVE' },
          select: { id: true },
          orderBy: { id: 'asc' }
        });
        await this.locks.lockTeams(tx, teams.map(({ id }) => id));
        const calculation = await this.calculate(tx, input.leagueId, input.seasonId, input.salaryRuleVersionId);
        if (input.expectedPreviewHash && input.expectedPreviewHash !== calculation.preview.previewHash) {
          throw new LeagueRosterError('SALARY_PREVIEW_STALE', '球员数值或工资已变化，请重新预览', 409);
        }
        const totals = new Map<string, number>();
        for (const { ownership, newOverall, quote } of calculation.rows) {
          await tx.leaguePlayerOwnership.update({
            where: { id: ownership.id },
            data: {
              salaryRuleVersionId: input.salaryRuleVersionId,
              maxOverallSnapshot: newOverall,
              salaryMinor: quote.salaryMinor,
              birdDiscountApplied: quote.birdDiscountApplied,
              version: { increment: 1 }
            }
          });
          await tx.rosterTransaction.create({
            data: {
              leagueId: input.leagueId,
              seasonId: input.seasonId,
              type: 'SALARY_RECALCULATION',
              footballPlayerId: ownership.footballPlayerId,
              sourceLeagueTeamId: ownership.leagueTeamId,
              targetLeagueTeamId: ownership.leagueTeamId,
              oldPlayerCardId: ownership.currentPlayerCardId,
              newPlayerCardId: ownership.currentPlayerCardId,
              oldSalaryMinor: ownership.salaryMinor,
              newSalaryMinor: quote.salaryMinor,
              reason: input.reason,
              createdByAdminId: adminId,
              createdAt: at
            }
          });
          totals.set(
            ownership.leagueTeamId,
            (totals.get(ownership.leagueTeamId) ?? 0) + quote.salaryMinor
          );
        }

        const teamResults = [];
        for (const team of teams) {
          const salaryMinor = totals.get(team.id) ?? 0;
          const salaryCapMinor = await this.teamSalaryCaps.readWithClient(tx, team.id) ?? 0;
          const rosterStatus = salaryMinor > salaryCapMinor ? 'OVER_CAP' : 'COMPLIANT';
          await tx.leagueTeam.update({
            where: { id: team.id },
            data: { rosterStatus, version: { increment: 1 } }
          });
          teamResults.push({ leagueTeamId: team.id, salaryMinor, rosterStatus });
        }
        const overCapTeams = teamResults.filter(({ rosterStatus }) => rosterStatus === 'OVER_CAP').length;
        await this.audit.record(tx, {
          actorAdminId: adminId,
          leagueId: input.leagueId,
          action: 'ROSTER_SALARIES_RECALCULATED',
          resourceType: 'LEAGUE_SALARY_RULE_VERSION',
          resourceId: input.salaryRuleVersionId,
          reason: input.reason,
          metadata: {
            seasonId: input.seasonId,
            recalculatedPlayers: calculation.rows.length,
            overCapTeams
          }
        });
        return {
          leagueId: input.leagueId,
          seasonId: input.seasonId,
          salaryRuleVersionId: input.salaryRuleVersionId,
          recalculatedPlayers: calculation.rows.length,
          overCapTeams,
          teams: teamResults
        };
      }, input);
  }

  private async requireScope(leagueId: string, seasonId: string, adminId: string) {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const seasonLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    if (seasonLeagueId !== leagueId) throw this.visibility.notFound();
    const season = await this.prisma.leagueSeason.findUnique({ where: { id: seasonId } });
    if (!season || season.leagueId !== leagueId) {
      throw new LeagueRosterError('ROSTER_SCOPE_MISMATCH', 'Season and league differ', 409);
    }
    await this.authorization.requireLeagueManager(adminId, leagueId);
  }

  private async calculate(
    client: PrismaService | Prisma.TransactionClient,
    leagueId: string,
    seasonId: string,
    salaryRuleVersionId: string
  ) {
    const rule = await client.leagueSalaryRuleVersion.findFirst({
      where: { id: salaryRuleVersionId, leagueId },
      include: { tiers: { orderBy: { minOverall: 'asc' } } }
    });
    if (!rule) throw new LeagueRosterError('SALARY_RULE_NOT_FOUND', 'Salary rule version was not found', 404);
    const teams = await client.leagueTeam.findMany({
      where: { leagueId, status: 'ACTIVE' },
      select: { id: true, name: true, salaryCapMinor: true }, orderBy: { id: 'asc' }
    });
    const ownerships = await client.leaguePlayerOwnership.findMany({
      where: { leagueId, status: 'ACTIVE', leagueTeam: { status: 'ACTIVE' } },
      include: {
        footballPlayer: { select: { nameZh: true, nameEn: true, shortName: true } },
        currentPlayerCard: { select: { autoBuilds: {
          orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }], take: 1,
          select: { maxOverall: true }
        } } }
      },
      orderBy: [{ leagueTeamId: 'asc' }, { id: 'asc' }]
    });
    const rows = ownerships.map((ownership) => {
      const newOverall = ownership.currentPlayerCard.autoBuilds[0]?.maxOverall ?? ownership.maxOverallSnapshot;
      const quote = salaryForOwnership(rule.tiers, newOverall, ownership.birdBaselineOverall);
      return { ownership, newOverall, quote };
    });
    const totals = new Map<string, { current: number; projected: number }>();
    for (const { ownership, quote } of rows) {
      const total = totals.get(ownership.leagueTeamId) ?? { current: 0, projected: 0 };
      total.current += ownership.salaryMinor;
      total.projected += quote.salaryMinor;
      totals.set(ownership.leagueTeamId, total);
    }
    const players = rows.filter(({ ownership, newOverall, quote }) =>
      newOverall !== ownership.maxOverallSnapshot || quote.salaryMinor !== ownership.salaryMinor
      || quote.birdDiscountApplied !== ownership.birdDiscountApplied
    ).map(({ ownership, newOverall, quote }) => ({
      ownershipId: ownership.id,
      leagueTeamId: ownership.leagueTeamId,
      playerName: ownership.footballPlayer.nameZh ?? ownership.footballPlayer.nameEn
        ?? ownership.footballPlayer.shortName ?? '未命名球员',
      oldOverall: ownership.maxOverallSnapshot,
      newOverall,
      oldSalaryMinor: ownership.salaryMinor,
      newSalaryMinor: quote.salaryMinor,
      birdDiscountApplied: quote.birdDiscountApplied
    }));
    const teamPreview = teams.map((team) => {
      const total = totals.get(team.id) ?? { current: 0, projected: 0 };
      return {
        leagueTeamId: team.id, teamName: team.name,
        currentSalaryMinor: total.current, projectedSalaryMinor: total.projected,
        salaryCapMinor: team.salaryCapMinor,
        projectedOverCap: team.salaryCapMinor === null || total.projected > team.salaryCapMinor
      };
    });
    const previewHash = createHash('sha256').update(JSON.stringify({
      leagueId, seasonId, salaryRuleVersionId,
      rows: rows.map(({ ownership, newOverall, quote }) => [
        ownership.id, ownership.version, ownership.maxOverallSnapshot, ownership.salaryMinor,
        ownership.birdBaselineOverall, ownership.birdDiscountApplied,
        newOverall, quote.salaryMinor, quote.birdDiscountApplied
      ]),
      teams: teamPreview.map((team) => [team.leagueTeamId, team.salaryCapMinor])
    })).digest('hex');
    return { rows, preview: { leagueId, seasonId, salaryRuleVersionId, previewHash, players, teams: teamPreview } };
  }
}
