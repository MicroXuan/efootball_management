import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ChangeTeamShellRequest,
  RefreshTeamShellRequest,
  SwapTeamShellRequest,
  TransferTeamShellRequest
} from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { LeagueTeam, TeamCatalogItem } from '../generated/prisma/client.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { LeagueError } from '../leagues/league.errors.js';

type ShellResult = { updatedTeamIds: string[] };

@Injectable()
export class LeagueTeamShellsService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async changeShell(
    actorAdminId: string,
    leagueId: string,
    teamId: string,
    input: ChangeTeamShellRequest,
    key: string
  ): Promise<ShellResult> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    return this.receipts.execute(actorAdminId, `league-team.change-shell:${teamId}`, key, async (tx) => {
      await this.lockLeague(tx, leagueId);
      const team = await this.team(tx, leagueId, teamId, input.expectedVersion);
      const next = await this.assignableShell(tx, leagueId, input.catalogTeamId, teamId);
      if (team.catalogTeamId === next.id) {
        throw new LeagueError('TEAM_SHELL_UNCHANGED', 'The team already uses this shell', 409);
      }
      await this.apply(tx, team.id, next, input.expectedVersion);
      await this.history(tx, actorAdminId, team, next.id, 'CHANGE', input.reason);
      await this.auditChange(tx, actorAdminId, leagueId, 'CHANGE_TEAM_SHELL', team.id, {
        fromCatalogTeamId: team.catalogTeamId, toCatalogTeamId: next.id
      }, input.reason);
      return { updatedTeamIds: [team.id] };
    }, input);
  }

  async refreshShell(
    actorAdminId: string,
    leagueId: string,
    teamId: string,
    input: RefreshTeamShellRequest,
    key: string
  ): Promise<ShellResult> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    return this.receipts.execute(actorAdminId, `league-team.refresh-shell:${teamId}`, key, async (tx) => {
      await this.lockLeague(tx, leagueId);
      const team = await this.team(tx, leagueId, teamId, input.expectedVersion);
      if (team.catalogTeamId !== input.catalogTeamId) {
        throw new LeagueError('TEAM_SHELL_BINDING_CHANGED', 'The team shell binding has changed', 409);
      }
      const shell = await this.readableShell(tx, input.catalogTeamId);
      await this.apply(tx, team.id, shell, input.expectedVersion);
      await this.history(tx, actorAdminId, team, shell.id, 'REFRESH', input.reason);
      await this.auditChange(tx, actorAdminId, leagueId, 'REFRESH_TEAM_SHELL', team.id, {
        catalogTeamId: shell.id
      }, input.reason);
      return { updatedTeamIds: [team.id] };
    }, input);
  }

  async transferShell(
    actorAdminId: string,
    leagueId: string,
    sourceTeamId: string,
    input: TransferTeamShellRequest,
    key: string
  ): Promise<ShellResult> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    return this.receipts.execute(actorAdminId, `league-team.transfer-shell:${sourceTeamId}`, key, async (tx) => {
      await this.lockLeague(tx, leagueId);
      if (sourceTeamId === input.targetTeamId) {
        throw new LeagueError('TEAM_SHELL_TRANSFER_TARGET_INVALID', 'Source and target teams must differ', 400);
      }
      const source = await this.team(tx, leagueId, sourceTeamId, input.expectedSourceVersion);
      const target = await this.team(tx, leagueId, input.targetTeamId, input.expectedTargetVersion);
      const replacement = await this.assignableShell(tx, leagueId, input.sourceReplacementCatalogTeamId, source.id);
      if (replacement.id === source.catalogTeamId || replacement.id === target.catalogTeamId) {
        throw new LeagueError('TEAM_SHELL_REPLACEMENT_INVALID', 'The source team requires a different available replacement shell', 409);
      }
      const transferred = await this.readableShell(tx, source.catalogTeamId);
      await this.apply(tx, source.id, replacement, input.expectedSourceVersion);
      await this.apply(tx, target.id, transferred, input.expectedTargetVersion);
      await Promise.all([
        this.history(tx, actorAdminId, source, replacement.id, 'TRANSFER', input.reason, target.id),
        this.history(tx, actorAdminId, target, transferred.id, 'TRANSFER', input.reason, source.id)
      ]);
      await this.auditChange(tx, actorAdminId, leagueId, 'TRANSFER_TEAM_SHELL', source.id, {
        sourceTeamId: source.id,
        targetTeamId: target.id,
        transferredCatalogTeamId: transferred.id,
        sourceReplacementCatalogTeamId: replacement.id
      }, input.reason);
      return { updatedTeamIds: [source.id, target.id] };
    }, input);
  }

  async swapShells(
    actorAdminId: string,
    leagueId: string,
    input: SwapTeamShellRequest,
    key: string
  ): Promise<ShellResult> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    return this.receipts.execute(actorAdminId, `league-team.swap-shells:${leagueId}`, key, async (tx) => {
      await this.lockLeague(tx, leagueId);
      if (input.sourceTeamId === input.otherTeamId) {
        throw new LeagueError('TEAM_SHELL_SWAP_TARGET_INVALID', 'Two distinct teams are required', 400);
      }
      const source = await this.team(tx, leagueId, input.sourceTeamId, input.expectedSourceVersion);
      const other = await this.team(tx, leagueId, input.otherTeamId, input.expectedOtherVersion);
      const [sourceShell, otherShell] = await Promise.all([
        this.readableShell(tx, source.catalogTeamId),
        this.readableShell(tx, other.catalogTeamId)
      ]);
      const temporary = await tx.teamCatalogItem.create({ data: {
        sourceType: 'CUSTOM',
        nameZh: `交换占位-${source.id}`,
        shortName: '交换占位',
        status: 'DISABLED'
      } });
      await tx.leagueTeam.update({ where: { id: source.id }, data: { catalogTeamId: temporary.id } });
      await this.apply(tx, other.id, sourceShell, input.expectedOtherVersion);
      await this.apply(tx, source.id, otherShell, input.expectedSourceVersion);
      await tx.teamCatalogItem.delete({ where: { id: temporary.id } });
      await Promise.all([
        this.history(tx, actorAdminId, source, otherShell.id, 'SWAP', input.reason, other.id),
        this.history(tx, actorAdminId, other, sourceShell.id, 'SWAP', input.reason, source.id)
      ]);
      await this.auditChange(tx, actorAdminId, leagueId, 'SWAP_TEAM_SHELL', source.id, {
        sourceTeamId: source.id,
        otherTeamId: other.id,
        sourceCatalogTeamId: sourceShell.id,
        otherCatalogTeamId: otherShell.id
      }, input.reason);
      return { updatedTeamIds: [source.id, other.id] };
    }, input);
  }

  private async lockLeague(tx: Prisma.TransactionClient, leagueId: string) {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`;
    const exists = await tx.league.findFirst({
      where: { id: leagueId, isDeleted: false },
      select: { id: true }
    });
    if (!exists) throw new LeagueError('LEAGUE_NOT_FOUND', 'League was not found', 404);
  }

  private async team(tx: Prisma.TransactionClient, leagueId: string, teamId: string, expectedVersion: number) {
    const team = await tx.leagueTeam.findFirst({ where: { id: teamId, leagueId } });
    if (!team) throw new LeagueError('LEAGUE_TEAM_NOT_FOUND', 'League team was not found', 404);
    if (team.version !== expectedVersion) {
      throw new LeagueError('VERSION_CONFLICT', 'League team has changed', 409);
    }
    return team;
  }

  private async readableShell(tx: Prisma.TransactionClient, catalogTeamId: string) {
    const shell = await tx.teamCatalogItem.findUnique({ where: { id: catalogTeamId } });
    if (!shell || !this.name(shell)) {
      throw new LeagueError('TEAM_CATALOG_ITEM_UNAVAILABLE', 'The selected team shell is unavailable', 409);
    }
    return shell;
  }

  private async assignableShell(
    tx: Prisma.TransactionClient,
    leagueId: string,
    catalogTeamId: string,
    currentTeamId: string
  ) {
    const shell = await this.readableShell(tx, catalogTeamId);
    if (shell.status !== 'ACTIVE') {
      throw new LeagueError('TEAM_CATALOG_ITEM_UNAVAILABLE', 'The selected team shell is unavailable', 409);
    }
    const occupied = await tx.leagueTeam.findFirst({
      where: { leagueId, catalogTeamId, id: { not: currentTeamId } }, select: { id: true }
    });
    if (occupied) {
      throw new LeagueError('LEAGUE_TEAM_SHELL_ALREADY_ASSIGNED', 'This team shell is already assigned in the league', 409);
    }
    return shell;
  }

  private async apply(
    tx: Prisma.TransactionClient,
    teamId: string,
    shell: TeamCatalogItem,
    expectedVersion: number
  ) {
    try {
      const changed = await tx.leagueTeam.updateMany({
        where: { id: teamId, version: expectedVersion },
        data: {
          catalogTeamId: shell.id,
          name: this.name(shell)!,
          shortName: shell.shortName,
          logoUrl: shell.storedLogoUrl,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw new LeagueError('VERSION_CONFLICT', 'League team has changed', 409);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new LeagueError('LEAGUE_TEAM_SHELL_ALREADY_ASSIGNED', 'This team shell is already assigned in the league', 409);
      }
      throw error;
    }
  }

  private name(shell: TeamCatalogItem) {
    return shell.nameZh ?? shell.nameEn ?? shell.nameJa;
  }

  private history(
    tx: Prisma.TransactionClient,
    actorAdminId: string,
    team: LeagueTeam,
    toCatalogTeamId: string,
    changeType: 'CHANGE' | 'TRANSFER' | 'SWAP' | 'REFRESH',
    reason?: string,
    relatedLeagueTeamId?: string
  ) {
    return tx.leagueTeamShellHistory.create({ data: {
      leagueId: team.leagueId,
      leagueTeamId: team.id,
      relatedLeagueTeamId: relatedLeagueTeamId ?? null,
      changeType,
      fromCatalogTeamId: team.catalogTeamId,
      toCatalogTeamId,
      actorAdminId,
      reason: reason ?? null
    } });
  }

  private auditChange(
    tx: Prisma.TransactionClient,
    actorAdminId: string,
    leagueId: string,
    action: 'CHANGE_TEAM_SHELL' | 'TRANSFER_TEAM_SHELL' | 'SWAP_TEAM_SHELL' | 'REFRESH_TEAM_SHELL',
    resourceId: string,
    metadata: Record<string, unknown>,
    reason?: string
  ) {
    return this.audit.record(tx, {
      actorAdminId, leagueId, action, resourceType: 'LeagueTeam', resourceId,
      reason: reason ?? null, metadata
    });
  }
}
