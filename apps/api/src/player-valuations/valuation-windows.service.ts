import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CreateValuationWindowRequestSchema,
  UpdateValuationWindowRequestSchema,
  type CreateValuationWindowRequest,
  type UpdateValuationWindowRequest,
  type ValuationWindowState
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminError } from '../admin/admin.errors.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type ValuationWindowRuleVersion } from '../generated/prisma/client.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

type WindowWithRule = {
  id: string;
  seasonId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  closedAt: Date | null;
  currentRuleVersionId: string | null;
  createdByAdminId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  currentRuleVersion: ValuationWindowRuleVersion | null;
};

@Injectable()
export class ValuationWindowsService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async create(
    adminId: string,
    seasonId: string,
    raw: CreateValuationWindowRequest,
    idempotencyKey: string,
    at = new Date()
  ) {
    const input = CreateValuationWindowRequestSchema.parse(raw);
    await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    const season = await this.prisma.leagueSeason.findUniqueOrThrow({ where: { id: seasonId } });
    await this.authorization.requireLeagueManager(adminId, season.leagueId);

    return this.receipts.execute(
      adminId,
      `VALUATION_WINDOW_CREATE:${seasonId}`,
      idempotencyKey,
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`);
        const created = await tx.valuationWindow.create({
          data: {
            seasonId,
            name: input.name,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            createdByAdminId: adminId
          }
        });
        const rule = await tx.valuationWindowRuleVersion.create({
          data: {
            windowId: created.id,
            version: 1,
            ...input.rule,
            createdByAdminId: adminId
          }
        });
        const isOpen = new Date(input.startsAt) <= at;
        if (isOpen) {
          await this.initializeRosterSnapshot(tx, created.id, seasonId, season.leagueId, at);
        }
        const window = await tx.valuationWindow.update({
          where: { id: created.id },
          data: {
            currentRuleVersionId: rule.id,
            ...(isOpen ? { snapshotInitializedAt: at } : {})
          },
          include: { currentRuleVersion: true }
        });
        await this.audit.record(tx, {
          actorAdminId: adminId,
          leagueId: season.leagueId,
          action: 'VALUATION_WINDOW_CREATED',
          resourceType: 'ValuationWindow',
          resourceId: created.id,
          metadata: { seasonId, ruleVersionId: rule.id, ruleVersion: 1 }
        });
        return this.present(window, at);
      },
      input
    );
  }

  async update(
    adminId: string,
    windowId: string,
    raw: UpdateValuationWindowRequest,
    idempotencyKey: string,
    at = new Date()
  ) {
    const input = UpdateValuationWindowRequestSchema.parse(raw);
    await this.requireVisibleWindow(windowId);
    const current = await this.prisma.valuationWindow.findUniqueOrThrow({
      where: { id: windowId },
      include: { season: true, currentRuleVersion: true }
    });
    await this.authorization.requireLeagueManager(adminId, current.season.leagueId);

    return this.receipts.execute(
      adminId,
      `VALUATION_WINDOW_UPDATE:${windowId}`,
      idempotencyKey,
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM valuation_windows WHERE id = ${windowId} FOR UPDATE`);
        const locked = await tx.valuationWindow.findUniqueOrThrow({
          where: { id: windowId },
          include: { currentRuleVersion: true }
        });
        if (locked.version !== input.expectedVersion) {
          throw new AdminError(
            'VALUATION_WINDOW_VERSION_CONFLICT',
            '身价窗口已被其他管理员修改，请刷新后重试',
            409
          );
        }
        if (locked.closedAt || at >= locked.endsAt) {
          throw new AdminError('VALUATION_WINDOW_CLOSED', '已关闭的身价窗口不能重新开放或修改', 409);
        }
        const startsAt = input.startsAt ? new Date(input.startsAt) : locked.startsAt;
        const endsAt = input.endsAt ? new Date(input.endsAt) : locked.endsAt;
        if (startsAt >= endsAt) {
          throw new AdminError('VALUATION_WINDOW_TIMELINE_INVALID', '结束时间必须晚于开始时间', 400);
        }

        let rule = locked.currentRuleVersion;
        if (input.rule) {
          const nextVersion = (rule?.version ?? 0) + 1;
          rule = await tx.valuationWindowRuleVersion.create({
            data: {
              windowId,
              version: nextVersion,
              ...input.rule,
              createdByAdminId: adminId
            }
          });
        }
        if (!rule) {
          throw new AdminError('VALUATION_WINDOW_RULE_MISSING', '身价窗口缺少有效规则', 409);
        }
        const updated = await tx.valuationWindow.update({
          where: { id: windowId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.startsAt !== undefined ? { startsAt } : {}),
            ...(input.endsAt !== undefined ? { endsAt } : {}),
            ...(input.rule ? { currentRuleVersionId: rule.id } : {}),
            ...(input.close ? { closedAt: at } : {}),
            version: { increment: 1 }
          },
          include: { currentRuleVersion: true }
        });
        await this.audit.record(tx, {
          actorAdminId: adminId,
          leagueId: current.season.leagueId,
          action: input.close ? 'VALUATION_WINDOW_CLOSED' : 'VALUATION_WINDOW_UPDATED',
          resourceType: 'ValuationWindow',
          resourceId: windowId,
          metadata: {
            seasonId: locked.seasonId,
            ruleVersionId: rule.id,
            ruleVersion: rule.version,
            version: updated.version
          }
        });
        return this.present(updated, at);
      },
      input
    );
  }

  async listForSeason(adminId: string, seasonId: string, at = new Date()) {
    await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    const season = await this.prisma.leagueSeason.findUniqueOrThrow({ where: { id: seasonId } });
    await this.authorization.requireLeagueManager(adminId, season.leagueId);
    const windows = await this.prisma.valuationWindow.findMany({
      where: { seasonId },
      include: { currentRuleVersion: true },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }]
    });
    return { items: windows.map((window) => this.present(window, at)) };
  }

  async getEffectiveRule(windowId: string, at = new Date()) {
    await this.requireVisibleWindow(windowId);
    const window = await this.prisma.valuationWindow.findUniqueOrThrow({
      where: { id: windowId },
      include: { currentRuleVersion: true, season: true }
    });
    if (!window.currentRuleVersion) {
      throw new AdminError('VALUATION_WINDOW_RULE_MISSING', '身价窗口缺少有效规则', 409);
    }
    return {
      window: this.present(window, at),
      rule: window.currentRuleVersion,
      leagueId: window.season.leagueId
    };
  }

  private present(window: WindowWithRule, at: Date) {
    if (!window.currentRuleVersion) {
      throw new AdminError('VALUATION_WINDOW_RULE_MISSING', '身价窗口缺少有效规则', 409);
    }
    return {
      id: window.id,
      seasonId: window.seasonId,
      name: window.name,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      closedAt: window.closedAt?.toISOString() ?? null,
      state: this.state(window, at),
      currentRule: {
        ...window.currentRuleVersion,
        createdAt: window.currentRuleVersion.createdAt.toISOString()
      },
      createdByAdminId: window.createdByAdminId,
      version: window.version,
      createdAt: window.createdAt.toISOString(),
      updatedAt: window.updatedAt.toISOString()
    };
  }

  private async requireVisibleWindow(windowId: string) {
    return this.visibility.requireVisible({ type: 'VALUATION_WINDOW', id: windowId });
  }

  private state(window: Pick<WindowWithRule, 'startsAt' | 'endsAt' | 'closedAt'>, at: Date): ValuationWindowState {
    if (window.closedAt || at >= window.endsAt) return 'CLOSED';
    if (at < window.startsAt) return 'SCHEDULED';
    return 'OPEN';
  }

  private async initializeRosterSnapshot(
    tx: Prisma.TransactionClient,
    windowId: string,
    seasonId: string,
    leagueId: string,
    at: Date
  ) {
    const entries = await tx.seasonEntry.findMany({
      where: { seasonId, status: 'APPROVED' },
      select: { leagueTeamId: true }
    });
    const teamIds = entries.map(({ leagueTeamId }) => leagueTeamId);
    if (teamIds.length === 0) return;
    const ownerships = await tx.leaguePlayerOwnership.findMany({
      where: { leagueTeamId: { in: teamIds }, status: 'ACTIVE', acquiredAt: { lte: at } },
      select: { id: true, leagueTeamId: true, footballPlayerId: true }
    });
    if (ownerships.length === 0) return;
    const valuations = await tx.leaguePlayerValuation.findMany({
      where: {
        leagueId,
        footballPlayerId: { in: ownerships.map(({ footballPlayerId }) => footballPlayerId) },
        effectiveAt: { lte: at }
      },
      select: { footballPlayerId: true, currentValueMinor: true }
    });
    const valueByPlayer = new Map(
      valuations.map(({ footballPlayerId, currentValueMinor }) => [footballPlayerId, currentValueMinor])
    );
    await tx.valuationRosterSnapshot.createMany({
      data: ownerships.map((ownership) => ({
        windowId,
        leagueTeamId: ownership.leagueTeamId,
        ownershipId: ownership.id,
        footballPlayerId: ownership.footballPlayerId,
        baseValueMinor: valueByPlayer.get(ownership.footballPlayerId) ?? null
      })),
      skipDuplicates: true
    });
  }
}
