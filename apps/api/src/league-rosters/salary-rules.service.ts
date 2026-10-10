import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CreateSalaryRuleVersionRequestSchema,
  PreviewSalaryRuleRequestSchema,
  type CreateSalaryRuleVersionRequest,
  type PreviewSalaryRuleRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeagueRosterError } from './league-roster.errors.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

export function defaultSalaryTiers() {
  return [
    { minOverall: 0, maxOverall: 92, salaryMinor: 100 },
    ...Array.from({ length: 7 }, (_, index) => ({
      minOverall: 93 + index,
      maxOverall: 93 + index,
      salaryMinor: 200 + index * 100
    })),
    { minOverall: 100, maxOverall: 120, salaryMinor: 900 }
  ];
}

function salaryFor(tiers: PreviewSalaryRuleRequest['tiers'], overall: number) {
  const tier = tiers.find(({ minOverall, maxOverall }) =>
    overall >= minOverall && overall <= maxOverall);
  if (!tier) {
    throw new LeagueRosterError(
      'SALARY_TIER_NOT_CONFIGURED',
      'No salary tier covers the automatic-build overall',
      422,
      { maxOverall: overall }
    );
  }
  return tier.salaryMinor;
}

@Injectable()
export class SalaryRulesService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async createVersion(adminId: string, leagueId: string, raw: CreateSalaryRuleVersionRequest) {
    const input = CreateSalaryRuleVersionRequestSchema.parse(raw);
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    await this.authorization.requireLeagueManager(adminId, leagueId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`);
      const latest = await tx.leagueSalaryRuleVersion.findFirst({
        where: { leagueId },
        orderBy: { version: 'desc' }
      });
      const currentVersion = latest?.version ?? 0;
      if (currentVersion !== input.expectedCurrentVersion) {
        throw new LeagueRosterError('VERSION_CONFLICT', 'Salary rule version has changed', 409, {
          currentVersion
        });
      }
      const effectiveAt = new Date(input.effectiveAt);
      if (latest && effectiveAt <= latest.effectiveAt) {
        throw new LeagueRosterError(
          'SALARY_RULE_EFFECTIVE_AT_NOT_INCREASING',
          'Salary rule effective time must be later than the previous version',
          409,
          { currentEffectiveAt: latest.effectiveAt.toISOString() }
        );
      }
      const created = await tx.leagueSalaryRuleVersion.create({
        data: {
          leagueId,
          version: currentVersion + 1,
          salaryCapMinor: input.salaryCapMinor,
          effectiveAt,
          createdByAdminId: adminId,
          tiers: { create: input.tiers }
        },
        include: { tiers: { orderBy: { minOverall: 'asc' } } }
      });
      await this.synchronizeRosterStatuses(tx, leagueId, input.salaryCapMinor);
      await this.audit.record(tx, {
        actorAdminId: adminId,
        leagueId,
        action: 'SALARY_RULE_VERSION_CREATED',
        resourceType: 'LEAGUE_SALARY_RULE_VERSION',
        resourceId: created.id,
        metadata: { version: created.version, salaryCapMinor: created.salaryCapMinor }
      });
      return created;
    });
  }

  private async synchronizeRosterStatuses(
    tx: Prisma.TransactionClient,
    leagueId: string,
    salaryCapMinor: number
  ) {
    await this.visibility.requireVisible(
      { type: 'LEAGUE', id: leagueId },
      tx
    );
    const teams = await tx.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true },
      orderBy: { id: 'asc' }
    });
    if (teams.length === 0) return;
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM league_teams
      WHERE league_id = ${leagueId}
      ORDER BY id
      FOR UPDATE
    `);
    const totals = await tx.leaguePlayerOwnership.groupBy({
      by: ['leagueTeamId'],
      where: { leagueId, status: 'ACTIVE' },
      _sum: { salaryMinor: true }
    });
    const salaryByTeam = new Map(totals.map(({ leagueTeamId, _sum }) => [
      leagueTeamId,
      _sum.salaryMinor ?? 0
    ]));
    for (const team of teams) {
      const rosterStatus = (salaryByTeam.get(team.id) ?? 0) > salaryCapMinor
        ? 'OVER_CAP'
        : 'COMPLIANT';
      await tx.leagueTeam.updateMany({
        where: { id: team.id, rosterStatus: { not: rosterStatus } },
        data: { rosterStatus, version: { increment: 1 } }
      });
    }
  }

  async quote(leagueId: string, overall: number, at = new Date()) {
    return this.quoteWithClient(this.prisma, leagueId, overall, at);
  }

  async quoteWithClient(
    client: PrismaService | Prisma.TransactionClient,
    leagueId: string,
    overall: number,
    at = new Date()
  ) {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId }, client as Prisma.TransactionClient);
    const rule = await client.leagueSalaryRuleVersion.findFirst({
      where: { leagueId, status: 'ACTIVE', effectiveAt: { lte: at } },
      orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }],
      include: { tiers: { orderBy: { minOverall: 'asc' } } }
    });
    if (!rule) {
      throw new LeagueRosterError('SALARY_RULE_NOT_CONFIGURED', 'No salary rule is active', 422);
    }
    return {
      salaryRuleVersionId: rule.id,
      version: rule.version,
      maxOverall: overall,
      salaryMinor: salaryFor(rule.tiers, overall),
      salaryCapMinor: rule.salaryCapMinor
    };
  }

  async quoteVersionWithClient(
    client: PrismaService | Prisma.TransactionClient,
    leagueId: string,
    salaryRuleVersionId: string,
    overall: number
  ) {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId }, client as Prisma.TransactionClient);
    const rule = await client.leagueSalaryRuleVersion.findFirst({
      where: { id: salaryRuleVersionId, leagueId },
      include: { tiers: { orderBy: { minOverall: 'asc' } } }
    });
    if (!rule) {
      throw new LeagueRosterError('SALARY_RULE_NOT_FOUND', 'Salary rule version was not found', 404);
    }
    return {
      salaryRuleVersionId: rule.id,
      version: rule.version,
      maxOverall: overall,
      salaryMinor: salaryFor(rule.tiers, overall),
      salaryCapMinor: rule.salaryCapMinor
    };
  }

  async previewRecalculation(leagueId: string, raw: PreviewSalaryRuleRequest) {
    const input = PreviewSalaryRuleRequestSchema.parse(raw);
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const ownerships = await this.prisma.leaguePlayerOwnership.findMany({
      where: { leagueId, status: 'ACTIVE' },
      include: { leagueTeam: { select: { name: true } } },
      orderBy: [{ leagueTeamId: 'asc' }, { id: 'asc' }]
    });
    const teams = new Map<string, { teamName: string; currentSalaryMinor: number; projectedSalaryMinor: number }>();
    for (const ownership of ownerships) {
      const aggregate = teams.get(ownership.leagueTeamId) ?? {
        teamName: ownership.leagueTeam.name,
        currentSalaryMinor: 0,
        projectedSalaryMinor: 0
      };
      aggregate.currentSalaryMinor += ownership.salaryMinor;
      aggregate.projectedSalaryMinor += salaryFor(input.tiers, ownership.maxOverallSnapshot);
      teams.set(ownership.leagueTeamId, aggregate);
    }
    return {
      salaryCapMinor: input.salaryCapMinor,
      teams: [...teams.entries()].map(([leagueTeamId, totals]) => ({
        leagueTeamId,
        ...totals,
        deltaMinor: totals.projectedSalaryMinor - totals.currentSalaryMinor,
        projectedStatus: totals.projectedSalaryMinor > input.salaryCapMinor ? 'OVER_CAP' : 'COMPLIANT'
      }))
    };
  }
}
