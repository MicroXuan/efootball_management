import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ParsedCreateLeagueTeamRequest,
  LeagueTeamDetail,
  LeagueTeamAdminListStatus,
  LeagueTeamLifecycleRequest,
  LeagueTeamListResponse,
  LeagueTeamSummary,
  MyLeagueTeamListResponse,
  MyLeagueTeamOverview,
  UpdateLeagueTeamRequest
} from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { LeagueTeam, User } from '../generated/prisma/client.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { LeagueTeamLifecycleService } from '../league-team-lifecycle/league-team-lifecycle.service.js';
import { assertLeagueExpectedVersion, LeagueError } from '../leagues/league.errors.js';
import { synchronizeSeasonValuationSnapshots } from '../player-valuations/valuation-snapshot-coordinator.js';

type TeamWithOwner = LeagueTeam & { owner: User; _count: { seasonEntries: number } };
type TeamRosterMetrics = { activePlayerCount: number; salaryTotalMinor: number; salaryCapMinor: number };

@Injectable()
export class LeagueTeamsService {
  private readonly visibility: LeagueVisibilityService;
  private readonly lifecycle: LeagueTeamLifecycleService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService,
    @Optional() @Inject(LeagueTeamLifecycleService) lifecycle?: LeagueTeamLifecycleService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
    this.lifecycle = lifecycle ?? new LeagueTeamLifecycleService(prisma, this.visibility);
  }

  async create(
    actorAdminId: string,
    leagueId: string,
    input: ParsedCreateLeagueTeamRequest,
    key: string
  ): Promise<LeagueTeamDetail> {
    if (!Number.isSafeInteger(input.salaryCapMinor) || input.salaryCapMinor <= 0 || input.salaryCapMinor > 4_294_967_295) {
      throw new LeagueError('TEAM_SALARY_CAP_REQUIRED', 'Set a positive team salary cap', 422);
    }
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    return this.receipts.execute(actorAdminId, `league-team.create:${leagueId}`, key, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`;
      const league = await transaction.league.findFirst({
        where: { id: leagueId, isDeleted: false }
      });
      if (!league) throw this.notFound('LEAGUE_NOT_FOUND', 'League was not found');
      if (!league.currentSeasonId) {
        throw new LeagueError(
          'LEAGUE_CURRENT_SEASON_REQUIRED',
          'Set the current season before binding a team',
          409
        );
      }
      const owner = await transaction.user.findUnique({ where: { id: input.ownerUserId } });
      if (!owner?.publicUserNo) throw this.notFound('PUBLIC_USER_NOT_FOUND', 'User was not found');
      await transaction.$queryRaw`SELECT id FROM team_catalog_items WHERE id = ${input.catalogTeamId} FOR UPDATE`;
      const catalogTeam = await transaction.teamCatalogItem.findUnique({ where: { id: input.catalogTeamId } });
      const catalogName = catalogTeam?.nameZh ?? catalogTeam?.nameEn ?? catalogTeam?.nameJa;
      if (!catalogTeam || catalogTeam.status !== 'ACTIVE' || !catalogName) {
        throw new LeagueError(
          'TEAM_CATALOG_ITEM_UNAVAILABLE',
          'The selected team shell is unavailable',
          409
        );
      }
      await this.assertAvailable(transaction, leagueId, owner.id, input.teamNumber, catalogTeam.id);
      await synchronizeSeasonValuationSnapshots(transaction, league.currentSeasonId);

      try {
        const team = await transaction.leagueTeam.create({
          data: {
            leagueId,
            ownerUserId: owner.id,
            ownerAlias: input.ownerAlias,
            catalogTeamId: catalogTeam.id,
            teamNumber: input.teamNumber,
            name: catalogName,
            shortName: catalogTeam.shortName,
            logoUrl: catalogTeam.storedLogoUrl,
            salaryCapMinor: input.salaryCapMinor,
            salaryCapConfirmedAt: new Date(),
            defaultGameAccountId: null
          }
        });
        const now = new Date();
        await transaction.seasonEntry.create({
          data: {
            seasonId: league.currentSeasonId,
            teamProfileId: null,
            leagueTeamId: team.id,
            ownerUserId: owner.id,
            gameAccountId: null,
            source: 'NEW_APPLICATION',
            status: 'APPROVED',
            previousSeasonEntryId: null,
            teamNameSnapshot: team.name,
            teamShortNameSnapshot: team.shortName,
            teamNumberSnapshot: team.teamNumber,
            teamLogoUrlSnapshot: team.logoUrl,
            gamePlatformSnapshot: null,
            serverRegionSnapshot: null,
            gamerTagSnapshot: null,
            gameUidSnapshot: null,
            leagueEditionSnapshot: league.edition,
            confirmedAt: now
          }
        });
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'CREATE_LEAGUE_TEAM',
          resourceType: 'LeagueTeam',
          resourceId: team.id,
          metadata: {
            ownerUserId: owner.id,
            ownerAlias: team.ownerAlias,
            teamNumber: team.teamNumber,
            catalogTeamId: team.catalogTeamId,
            salaryCapMinor: team.salaryCapMinor,
            currentSeasonId: league.currentSeasonId
          }
        });
        return this.detail({ ...team, owner, _count: { seasonEntries: 1 } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const target = JSON.stringify(error.meta?.target ?? '');
          if (target.includes('owner')) {
            throw new LeagueError(
              'LEAGUE_TEAM_OWNER_ALREADY_EXISTS',
              'This user already owns a team in the league',
              409
            );
          }
          if (target.includes('number')) {
            throw new LeagueError(
              'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS',
              'Team number is already assigned in this league',
              409
            );
          }
          if (target.includes('catalog')) {
            throw new LeagueError(
              'LEAGUE_TEAM_SHELL_ALREADY_ASSIGNED',
              'This team shell is already assigned in the league',
              409
            );
          }
          throw new LeagueError('LEAGUE_TEAM_CONFLICT', 'League team already exists', 409);
        }
        throw error;
      }
    });
  }

  async update(
    actorAdminId: string,
    leagueId: string,
    teamId: string,
    input: UpdateLeagueTeamRequest,
    key: string
  ): Promise<LeagueTeamDetail> {
    const teamLeagueId = await this.lifecycle.requireActive(teamId);
    if (teamLeagueId !== leagueId) throw this.visibility.notFound();
    return this.receipts.execute(actorAdminId, `league-team.update:${teamId}`, key, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM league_teams WHERE id = ${teamId} FOR UPDATE`;
      const existing = await transaction.leagueTeam.findFirst({
        where: { id: teamId, leagueId, league: { isDeleted: false } }
      });
      if (!existing) throw this.notFound('LEAGUE_TEAM_NOT_FOUND', 'League team was not found');
      if (input.salaryCapMinor !== undefined &&
        (!Number.isSafeInteger(input.salaryCapMinor) || input.salaryCapMinor <= 0 || input.salaryCapMinor > 4_294_967_295 ||
          input.salaryCapConfirmed !== true || !input.reason?.trim())) {
        throw new LeagueError('TEAM_SALARY_CAP_INVALID', 'Confirm a positive salary cap and provide a reason', 422);
      }
      const salary = input.salaryCapMinor === undefined ? null : await transaction.leaguePlayerOwnership.aggregate({
        where: { leagueTeamId: teamId, status: 'ACTIVE' },
        _sum: { salaryMinor: true }
      });
      const salaryTotalMinor = salary?._sum.salaryMinor ?? 0;
      const projectedRosterStatus = input.salaryCapMinor === undefined ? existing.rosterStatus :
        salaryTotalMinor > input.salaryCapMinor ? 'OVER_CAP' : 'COMPLIANT';
      if (input.teamNumber !== undefined && input.teamNumber !== existing.teamNumber) {
        const participationCount = await transaction.seasonEntry.count({
          where: { leagueTeamId: teamId }
        });
        if (participationCount > 0) {
          throw new LeagueError(
            'LEAGUE_TEAM_NUMBER_LOCKED',
            'Team number cannot change after the team enters a season',
            409
          );
        }
        const numberOwner = await transaction.leagueTeam.findFirst({
          where: { leagueId, teamNumber: input.teamNumber, id: { not: teamId } },
          select: { id: true }
        });
        if (numberOwner) {
          throw new LeagueError(
            'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS',
            'Team number is already assigned in this league',
            409
          );
        }
      }
      const changed = await transaction.leagueTeam.updateMany({
        where: { id: teamId, leagueId, version: input.expectedVersion },
        data: {
          ...(input.teamNumber !== undefined ? { teamNumber: input.teamNumber } : {}),
          ...(input.ownerAlias !== undefined ? { ownerAlias: input.ownerAlias } : {}),
          ...(input.shellValueMinor !== undefined ? { shellValueMinor: input.shellValueMinor } : {}),
          ...(input.salaryCapMinor !== undefined ? {
            salaryCapMinor: input.salaryCapMinor,
            salaryCapConfirmedAt: new Date(),
            rosterStatus: projectedRosterStatus
          } : {}),
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw new LeagueError('VERSION_CONFLICT', 'League team has changed', 409);
      const updated = await this.record(transaction, teamId);
      await this.audit.record(transaction, {
        actorAdminId,
        leagueId,
        action: input.salaryCapMinor !== undefined
          ? 'TEAM_SALARY_CAP_UPDATED'
          : input.shellValueMinor !== undefined
          ? 'LEAGUE_TEAM_SHELL_VALUE_UPDATED'
          : 'league-team.update',
        resourceType: 'LeagueTeam',
        resourceId: teamId,
        ...(input.salaryCapMinor !== undefined ? { reason: input.reason!.trim() } : {}),
        metadata: input.salaryCapMinor !== undefined ? {
          oldSalaryCapMinor: existing.salaryCapMinor,
          newSalaryCapMinor: input.salaryCapMinor,
          salaryTotalMinor,
          oldRosterStatus: existing.rosterStatus,
          projectedRosterStatus,
          version: updated.version
        } : Object.fromEntries(Object.entries(input).filter(([field]) => field !== 'expectedVersion'))
      });
      const metrics = await this.rosterMetrics(transaction, [updated]);
      return this.detail(updated, metrics.get(updated.id));
    });
  }

  archive(
    actorAdminId: string,
    leagueId: string,
    teamId: string,
    input: LeagueTeamLifecycleRequest,
    key: string
  ): Promise<LeagueTeamDetail> {
    return this.changeLifecycle(actorAdminId, leagueId, teamId, input, key, 'ACTIVE', 'ARCHIVED');
  }

  restore(
    actorAdminId: string,
    leagueId: string,
    teamId: string,
    input: LeagueTeamLifecycleRequest,
    key: string
  ): Promise<LeagueTeamDetail> {
    return this.changeLifecycle(actorAdminId, leagueId, teamId, input, key, 'ARCHIVED', 'ACTIVE');
  }

  async listMine(ownerUserId: string): Promise<LeagueTeamListResponse> {
    const teams = await this.prisma.leagueTeam.findMany({
      where: { ownerUserId, status: { not: 'ARCHIVED' }, league: { isDeleted: false } },
      include: { owner: true, _count: { select: { seasonEntries: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
    });
    const metrics = await this.rosterMetrics(this.prisma, teams);
    return { items: teams.map((team) => this.summary(team, metrics.get(team.id))), nextCursor: null };
  }

  async listMineViews(ownerUserId: string): Promise<MyLeagueTeamListResponse> {
    const teams = await this.prisma.leagueTeam.findMany({
      where: { ownerUserId, status: { not: 'ARCHIVED' }, league: { isDeleted: false } },
      include: {
        owner: true,
        _count: { select: { seasonEntries: true } },
        league: {
          include: {
            currentSeason: {
              include: {
                _count: {
                  select: { entries: { where: { status: 'APPROVED' } } }
                }
              }
            }
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
    });
    const metrics = await this.rosterMetrics(this.prisma, teams);
    return {
      items: teams.map((team) => ({
        ...this.summary(team, metrics.get(team.id)),
        leagueName: team.league.name,
        leagueDescription: team.league.description,
        leagueLogoUrl: team.league.logoUrl,
        leagueEdition: team.league.edition,
        currentSeason: team.league.currentSeason ? {
          id: team.league.currentSeason.id,
          displayName: team.league.currentSeason.displayName,
          status: team.league.currentSeason.status,
          approvedEntryCount: team.league.currentSeason._count.entries
        } : null
      })),
      nextCursor: null
    };
  }

  async getMyOverview(teamId: string, ownerUserId: string): Promise<MyLeagueTeamOverview> {
    const team = await this.getDetail(teamId, ownerUserId);
    const now = new Date();
    const [league, roster, ledger, currentWindow, activeValuationWindow] = await Promise.all([
      this.prisma.league.findUniqueOrThrow({ where: { id: team.leagueId }, select: { name: true } }),
      this.prisma.leaguePlayerOwnership.findMany({
        where: { leagueTeamId: teamId, status: 'ACTIVE' },
        include: {
          footballPlayer: true,
          currentPlayerCard: { include: { attributes: true } }
        },
        orderBy: [{ acquiredAt: 'asc' }, { id: 'asc' }]
      }),
      this.prisma.financeLedgerEntry.findMany({
        where: { leagueTeamId: teamId },
        include: { leagueTeam: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50
      }),
      this.prisma.transferWindow.findFirst({
        where: {
          season: { leagueId: team.leagueId },
          startsAt: { lte: now },
          endsAt: { gt: now }
        },
        orderBy: { startsAt: 'asc' }
      }),
      this.prisma.valuationWindow.findFirst({
        where: {
          season: { leagueId: team.leagueId },
          startsAt: { lte: now },
          endsAt: { gt: now },
          closedAt: null
        },
        select: { id: true }
      })
    ]);
    return {
      team,
      leagueName: league.name,
      roster: roster.map((entry) => {
        const attributes = this.attributes(entry.currentPlayerCard.attributes?.attributesJson);
        return {
          id: entry.id,
          leagueId: entry.leagueId,
          leagueTeamId: entry.leagueTeamId,
          playerId: entry.footballPlayerId,
          playerName: entry.footballPlayer.nameZh ?? entry.footballPlayer.nameEn ?? entry.footballPlayer.shortName ?? '未命名球员',
          currentPlayerCardId: entry.currentPlayerCardId,
          cardName: entry.currentPlayerCard.cardName,
          position: entry.currentPlayerCard.position,
          heightCm: this.integer(attributes.heightCm ?? attributes.height),
          maxOverall: entry.maxOverallSnapshot,
          salaryRuleVersionId: entry.salaryRuleVersionId,
          salaryMinor: entry.salaryMinor,
          acquiredAt: entry.acquiredAt.toISOString(),
          status: entry.status,
          version: entry.version
        };
      }),
      ledger: ledger.map((entry) => ({
        id: entry.id,
        leagueId: entry.leagueId,
        leagueTeamId: entry.leagueTeamId,
        seasonId: entry.seasonId,
        teamName: entry.leagueTeam.name,
        rosterTransactionId: entry.rosterTransactionId,
        direction: entry.direction,
        type: entry.type,
        settlementCategory: entry.settlementCategory,
        amountMinor: entry.amountMinor,
        note: entry.note,
        createdAt: entry.createdAt.toISOString()
      })),
      canManageValuations: Boolean(activeValuationWindow),
      currentWindow: currentWindow ? {
        name: currentWindow.name,
        endsAt: currentWindow.endsAt.toISOString(),
        operations: {
          BUY: currentWindow.allowBuy,
          SELL: currentWindow.allowSell,
          TRANSFER: currentWindow.allowTransfer,
          CARD_UPGRADE: currentWindow.allowCardUpgrade
        }
      } : null
    };
  }

  async listForLeague(
    leagueId: string,
    status: LeagueTeamAdminListStatus = 'ACTIVE'
  ): Promise<LeagueTeamListResponse> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const teams = await this.prisma.leagueTeam.findMany({
      where: { leagueId, status, league: { isDeleted: false } },
      include: { owner: true, _count: { select: { seasonEntries: true } } },
      orderBy: [{ teamNumber: 'asc' }, { id: 'asc' }]
    });
    const metrics = await this.rosterMetrics(this.prisma, teams);
    return { items: teams.map((team) => this.summary(team, metrics.get(team.id))), nextCursor: null };
  }

  async getDetail(teamId: string, ownerUserId?: string, leagueId?: string): Promise<LeagueTeamDetail> {
    await this.visibility.requireVisible({ type: 'TEAM', id: teamId });
    const team = await this.prisma.leagueTeam.findFirst({
      where: {
        id: teamId,
        status: 'ACTIVE',
        league: { isDeleted: false },
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(leagueId ? { leagueId } : {})
      },
      include: { owner: true, _count: { select: { seasonEntries: true } } }
    });
    if (!team) throw this.notFound('LEAGUE_TEAM_NOT_FOUND', 'League team was not found');
    const metrics = await this.rosterMetrics(this.prisma, [team]);
    return this.detail(team, metrics.get(team.id));
  }

  async getAdminDetail(teamId: string, leagueId: string): Promise<LeagueTeamDetail> {
    const teamLeagueId = await this.visibility.requireVisible({ type: 'TEAM', id: teamId });
    if (teamLeagueId !== leagueId) throw this.visibility.notFound();
    const team = await this.prisma.leagueTeam.findFirst({
      where: { id: teamId, leagueId, league: { isDeleted: false } },
      include: { owner: true, _count: { select: { seasonEntries: true } } }
    });
    if (!team) throw this.notFound('LEAGUE_TEAM_NOT_FOUND', 'League team was not found');
    const metrics = await this.rosterMetrics(this.prisma, [team]);
    return this.detail(team, metrics.get(team.id));
  }

  private async changeLifecycle(
    actorAdminId: string,
    leagueId: string,
    teamId: string,
    input: LeagueTeamLifecycleRequest,
    key: string,
    fromStatus: 'ACTIVE' | 'ARCHIVED',
    toStatus: 'ACTIVE' | 'ARCHIVED'
  ): Promise<LeagueTeamDetail> {
    const visibleLeagueId = await this.visibility.requireVisible({ type: 'TEAM', id: teamId });
    if (visibleLeagueId !== leagueId) throw this.visibility.notFound();
    const action = toStatus === 'ARCHIVED' ? 'league-team.archive' : 'league-team.restore';
    return this.receipts.execute(
      actorAdminId,
      `${action}:${teamId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM league_teams WHERE id = ${teamId} FOR UPDATE`;
        const transactionLeagueId = await this.visibility.requireVisible({ type: 'TEAM', id: teamId }, transaction);
        if (transactionLeagueId !== leagueId) throw this.visibility.notFound();
        const existing = await transaction.leagueTeam.findFirst({
          where: { id: teamId, leagueId },
          include: { owner: true, _count: { select: { seasonEntries: true } } }
        });
        if (!existing) throw this.visibility.notFound();
        if (existing.status === toStatus) return this.detail(existing);
        if (existing.status !== fromStatus) {
          throw new LeagueError('LEAGUE_TEAM_STATE_INVALID', 'League team lifecycle transition is invalid', 409);
        }
        assertLeagueExpectedVersion(existing.version, input.expectedVersion, 'League team');
        const changed = await transaction.leagueTeam.updateMany({
          where: { id: teamId, leagueId, status: fromStatus, version: input.expectedVersion },
          data: { status: toStatus, version: { increment: 1 } }
        });
        if (changed.count !== 1) {
          throw new LeagueError('VERSION_CONFLICT', 'League team has changed', 409);
        }
        if (toStatus === 'ARCHIVED') {
          await transaction.seasonAllocationProposal.updateMany({
            where: {
              status: 'DRAFT',
              season: { status: { in: ['DRAFT', 'REGISTRATION_OPEN', 'ALLOCATION_REVIEW'] } },
              rows: {
                some: {
                  seasonEntry: { leagueTeamId: teamId, status: 'APPROVED' }
                }
              }
            },
            data: { status: 'SUPERSEDED' }
          });
          await transaction.seasonEntry.updateMany({
            where: {
              leagueTeamId: teamId,
              status: 'APPROVED',
              season: { status: { in: ['DRAFT', 'REGISTRATION_OPEN', 'ALLOCATION_REVIEW'] } }
            },
            data: {
              status: 'WITHDRAWN',
              withdrawnAt: new Date(),
              version: { increment: 1 }
            }
          });
        }
        const updated = await this.record(transaction, teamId);
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action,
          resourceType: 'LeagueTeam',
          resourceId: teamId,
          reason: input.reason,
          metadata: { fromStatus, toStatus, version: updated.version }
        });
        return this.detail(updated);
      },
      input
    );
  }

  private async record(client: Prisma.TransactionClient, teamId: string): Promise<TeamWithOwner> {
    return client.leagueTeam.findFirstOrThrow({
      where: { id: teamId, league: { isDeleted: false } },
      include: { owner: true, _count: { select: { seasonEntries: true } } }
    });
  }

  private async assertAvailable(
    client: Prisma.TransactionClient,
    leagueId: string,
    ownerUserId: string,
    teamNumber: number,
    catalogTeamId: string
  ) {
    const owner = await client.leagueTeam.findUnique({
      where: { leagueId_ownerUserId: { leagueId, ownerUserId } },
      select: { id: true }
    });
    if (owner) {
      throw new LeagueError(
        'LEAGUE_TEAM_OWNER_ALREADY_EXISTS',
        'This user already owns a team in the league',
        409
      );
    }
    const number = await client.leagueTeam.findFirst({
      where: { leagueId, teamNumber },
      select: { id: true }
    });
    if (number) {
      throw new LeagueError(
        'LEAGUE_TEAM_NUMBER_ALREADY_EXISTS',
        'Team number is already assigned in this league',
        409
      );
    }
    const shell = await client.leagueTeam.findFirst({
      where: { leagueId, catalogTeamId },
      select: { id: true }
    });
    if (shell) {
      throw new LeagueError(
        'LEAGUE_TEAM_SHELL_ALREADY_ASSIGNED',
        'This team shell is already assigned in the league',
        409
      );
    }
  }

  private async rosterMetrics(
    client: PrismaService | Prisma.TransactionClient,
    teams: TeamWithOwner[]
  ): Promise<Map<string, TeamRosterMetrics>> {
    if (teams.length === 0) return new Map();
    const teamIds = teams.map(({ id }) => id);
    const ownerships = await client.leaguePlayerOwnership.groupBy({
      by: ['leagueTeamId'],
      where: { leagueTeamId: { in: teamIds }, status: 'ACTIVE' },
      _count: { _all: true },
      _sum: { salaryMinor: true }
    });
    const ownershipByTeam = new Map(
      ownerships.map((row) => [row.leagueTeamId, {
        activePlayerCount: row._count._all,
        salaryTotalMinor: row._sum.salaryMinor ?? 0
      }])
    );
    return new Map(teams.map((team) => {
      const ownership = ownershipByTeam.get(team.id);
      return [team.id, {
        activePlayerCount: ownership?.activePlayerCount ?? 0,
        salaryTotalMinor: ownership?.salaryTotalMinor ?? 0,
        salaryCapMinor: team.salaryCapMinor ?? 0
      }];
    }));
  }

  private summary(team: TeamWithOwner, metrics?: TeamRosterMetrics): LeagueTeamSummary {
    if (!team.owner.publicUserNo) {
      throw new LeagueError('PUBLIC_USER_NUMBER_MISSING', 'Team owner has no public user number', 409);
    }
    return {
      id: team.id,
      leagueId: team.leagueId,
      ownerUserId: team.ownerUserId,
      ownerPublicUserNo: team.owner.publicUserNo,
      ownerDisplayName: team.owner.displayName,
      ownerAlias: team.ownerAlias,
      catalogTeamId: team.catalogTeamId,
      teamNumber: team.teamNumber,
      name: team.name,
      shortName: team.shortName,
      logoUrl: team.logoUrl,
      status: team.status,
      rosterStatus: team.rosterStatus,
      activePlayerCount: metrics?.activePlayerCount ?? 0,
      salaryTotalMinor: metrics?.salaryTotalMinor ?? 0,
      salaryCapMinor: metrics?.salaryCapMinor ?? team.salaryCapMinor ?? 0,
      salaryCapConfirmed: Boolean(team.salaryCapConfirmedAt),
      salaryCapConfirmedAt: team.salaryCapConfirmedAt?.toISOString() ?? null,
      shellValueMinor: team.shellValueMinor,
      version: team.version,
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString()
    };
  }

  private detail(team: TeamWithOwner, metrics?: TeamRosterMetrics): LeagueTeamDetail {
    return {
      ...this.summary(team, metrics),
      ownerDisplayName: team.owner.displayName,
      defaultGameAccountId: team.defaultGameAccountId,
      participatingSeasonCount: team._count.seasonEntries
    };
  }

  private attributes(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private integer(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
  }

  private notFound(code: string, message: string) {
    return new LeagueError(code, message, 404);
  }
}
