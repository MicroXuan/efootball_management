import { Inject, Injectable } from '@nestjs/common';
import type {
  ParsedCreateLeagueTeamRequest,
  LeagueTeamDetail,
  LeagueTeamListResponse,
  LeagueTeamSummary,
  UpdateLeagueTeamRequest
} from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { League, LeagueTeam, User } from '../generated/prisma/client.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from '../leagues/league.errors.js';

type TeamWithOwner = LeagueTeam & { owner: User; _count: { seasonEntries: number } };

@Injectable()
export class LeagueTeamsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  create(
    actorAdminId: string,
    leagueId: string,
    input: ParsedCreateLeagueTeamRequest,
    key: string
  ): Promise<LeagueTeamDetail> {
    return this.receipts.execute(actorAdminId, `league-team.create:${leagueId}`, key, async (transaction) => {
      const league = await transaction.league.findUnique({ where: { id: leagueId } });
      if (!league) throw this.notFound('LEAGUE_NOT_FOUND', 'League was not found');
      const owner = await transaction.user.findUnique({ where: { id: input.ownerUserId } });
      if (!owner?.publicUserNo) throw this.notFound('PUBLIC_USER_NOT_FOUND', 'User was not found');
      await this.assertAccount(transaction, league, owner.id, input.defaultGameAccountId);
      await this.assertAvailable(transaction, leagueId, owner.id, input.teamNumber);

      try {
        const team = await transaction.leagueTeam.create({
          data: {
            leagueId,
            ownerUserId: owner.id,
            teamNumber: input.teamNumber,
            name: input.name,
            shortName: input.shortName,
            logoUrl: input.logoUrl,
            defaultGameAccountId: input.defaultGameAccountId
          }
        });
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'league-team.create',
          resourceType: 'LeagueTeam',
          resourceId: team.id,
          metadata: { ownerUserId: owner.id, teamNumber: team.teamNumber }
        });
        return this.detail({ ...team, owner, _count: { seasonEntries: 0 } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new LeagueError('LEAGUE_TEAM_CONFLICT', 'League team already exists', 409);
        }
        throw error;
      }
    });
  }

  update(
    actorAdminId: string,
    leagueId: string,
    teamId: string,
    input: UpdateLeagueTeamRequest,
    key: string
  ): Promise<LeagueTeamDetail> {
    return this.receipts.execute(actorAdminId, `league-team.update:${teamId}`, key, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM league_teams WHERE id = ${teamId} FOR UPDATE`;
      const existing = await transaction.leagueTeam.findFirst({ where: { id: teamId, leagueId } });
      if (!existing) throw this.notFound('LEAGUE_TEAM_NOT_FOUND', 'League team was not found');
      const league = await transaction.league.findUniqueOrThrow({ where: { id: leagueId } });
      if (input.defaultGameAccountId !== undefined) {
        await this.assertAccount(transaction, league, existing.ownerUserId, input.defaultGameAccountId);
      }
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
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
          ...(input.defaultGameAccountId !== undefined
            ? { defaultGameAccountId: input.defaultGameAccountId }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw new LeagueError('VERSION_CONFLICT', 'League team has changed', 409);
      const updated = await this.record(transaction, teamId);
      await this.audit.record(transaction, {
        actorAdminId,
        leagueId,
        action: 'league-team.update',
        resourceType: 'LeagueTeam',
        resourceId: teamId,
        metadata: Object.fromEntries(
          Object.entries(input).filter(([field]) => field !== 'expectedVersion')
        )
      });
      return this.detail(updated);
    });
  }

  async listMine(ownerUserId: string): Promise<LeagueTeamListResponse> {
    const teams = await this.prisma.leagueTeam.findMany({
      where: { ownerUserId },
      include: { owner: true, _count: { select: { seasonEntries: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
    });
    return { items: teams.map((team) => this.summary(team)), nextCursor: null };
  }

  async listForLeague(leagueId: string): Promise<LeagueTeamListResponse> {
    const teams = await this.prisma.leagueTeam.findMany({
      where: { leagueId },
      include: { owner: true, _count: { select: { seasonEntries: true } } },
      orderBy: [{ teamNumber: 'asc' }, { id: 'asc' }]
    });
    return { items: teams.map((team) => this.summary(team)), nextCursor: null };
  }

  async getDetail(teamId: string, ownerUserId?: string, leagueId?: string): Promise<LeagueTeamDetail> {
    const team = await this.prisma.leagueTeam.findFirst({
      where: {
        id: teamId,
        ...(ownerUserId ? { ownerUserId } : {}),
        ...(leagueId ? { leagueId } : {})
      },
      include: { owner: true, _count: { select: { seasonEntries: true } } }
    });
    if (!team) throw this.notFound('LEAGUE_TEAM_NOT_FOUND', 'League team was not found');
    return this.detail(team);
  }

  private async record(client: Prisma.TransactionClient, teamId: string): Promise<TeamWithOwner> {
    return client.leagueTeam.findUniqueOrThrow({
      where: { id: teamId },
      include: { owner: true, _count: { select: { seasonEntries: true } } }
    });
  }

  private async assertAvailable(
    client: Prisma.TransactionClient,
    leagueId: string,
    ownerUserId: string,
    teamNumber: number
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
  }

  private async assertAccount(
    client: Prisma.TransactionClient,
    league: League,
    ownerUserId: string,
    accountId: string | null
  ) {
    if (!accountId) return;
    const account = await client.gameAccount.findFirst({ where: { id: accountId, userId: ownerUserId } });
    if (!account) {
      throw new LeagueError('GAME_ACCOUNT_NOT_OWNED', 'Game account is not owned by the team owner', 400);
    }
    if (account.platform !== league.defaultPlatform || account.serverRegion !== league.defaultServerRegion) {
      throw new LeagueError(
        'GAME_ACCOUNT_INELIGIBLE',
        'Game account does not match league platform and server eligibility',
        409
      );
    }
  }

  private summary(team: TeamWithOwner): LeagueTeamSummary {
    if (!team.owner.publicUserNo) {
      throw new LeagueError('PUBLIC_USER_NUMBER_MISSING', 'Team owner has no public user number', 409);
    }
    return {
      id: team.id,
      leagueId: team.leagueId,
      ownerUserId: team.ownerUserId,
      ownerPublicUserNo: team.owner.publicUserNo,
      teamNumber: team.teamNumber,
      name: team.name,
      shortName: team.shortName,
      logoUrl: team.logoUrl,
      status: team.status,
      rosterStatus: team.rosterStatus,
      activePlayerCount: 0,
      salaryTotalMinor: 0,
      salaryCapMinor: 0,
      version: team.version,
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString()
    };
  }

  private detail(team: TeamWithOwner): LeagueTeamDetail {
    return {
      ...this.summary(team),
      ownerDisplayName: team.owner.displayName,
      defaultGameAccountId: team.defaultGameAccountId,
      participatingSeasonCount: team._count.seasonEntries
    };
  }

  private notFound(code: string, message: string) {
    return new LeagueError(code, message, 404);
  }
}
