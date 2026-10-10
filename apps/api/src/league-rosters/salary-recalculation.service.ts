import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  RecalculateLeagueSalaryRequestSchema,
  type RecalculateLeagueSalaryRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueRosterError } from './league-roster.errors.js';
import { RosterLockRepository } from './roster-lock.repository.js';
import { SalaryRulesService } from './salary-rules.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

@Injectable()
export class SalaryRecalculationService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(SalaryRulesService) private readonly salaryRules: SalaryRulesService,
    @Inject(RosterLockRepository) private readonly locks: RosterLockRepository,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async recalculateLeague(
    raw: RecalculateLeagueSalaryRequest,
    adminId: string,
    at = new Date()
  ) {
    const input = RecalculateLeagueSalaryRequestSchema.parse(raw);
    await this.visibility.requireVisible({ type: 'LEAGUE', id: input.leagueId });
    const seasonLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: input.seasonId });
    if (seasonLeagueId !== input.leagueId) throw this.visibility.notFound();
    const season = await this.prisma.leagueSeason.findUnique({ where: { id: input.seasonId } });
    if (!season || season.leagueId !== input.leagueId) {
      throw new LeagueRosterError('ROSTER_SCOPE_MISMATCH', 'Season and league differ', 409);
    }
    await this.authorization.requireLeagueManager(adminId, input.leagueId);

    return this.receipts.execute(adminId, 'ROSTER_SALARY_RECALCULATION', input.idempotencyKey,
      async (tx) => {
        const teams = await tx.leagueTeam.findMany({
          where: { leagueId: input.leagueId, status: 'ACTIVE' },
          select: { id: true },
          orderBy: { id: 'asc' }
        });
        await this.locks.lockTeams(tx, teams.map(({ id }) => id));
        const rule = await tx.leagueSalaryRuleVersion.findFirst({
          where: { id: input.salaryRuleVersionId, leagueId: input.leagueId }
        });
        if (!rule) {
          throw new LeagueRosterError('SALARY_RULE_NOT_FOUND', 'Salary rule version was not found', 404);
        }
        const ownerships = await tx.leaguePlayerOwnership.findMany({
          where: { leagueId: input.leagueId, status: 'ACTIVE', leagueTeam: { status: 'ACTIVE' } },
          orderBy: [{ leagueTeamId: 'asc' }, { id: 'asc' }]
        });
        const totals = new Map<string, number>();
        for (const ownership of ownerships) {
          const quote = await this.salaryRules.quoteVersionWithClient(
            tx,
            input.leagueId,
            input.salaryRuleVersionId,
            ownership.maxOverallSnapshot
          );
          await tx.leaguePlayerOwnership.update({
            where: { id: ownership.id },
            data: {
              salaryRuleVersionId: input.salaryRuleVersionId,
              salaryMinor: quote.salaryMinor,
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
          const rosterStatus = salaryMinor > rule.salaryCapMinor ? 'OVER_CAP' : 'COMPLIANT';
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
            recalculatedPlayers: ownerships.length,
            overCapTeams
          }
        });
        return {
          leagueId: input.leagueId,
          seasonId: input.seasonId,
          salaryRuleVersionId: input.salaryRuleVersionId,
          recalculatedPlayers: ownerships.length,
          overCapTeams,
          teams: teamResults
        };
      }, input);
  }
}
