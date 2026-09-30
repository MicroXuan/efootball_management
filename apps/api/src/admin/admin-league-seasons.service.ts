import { Inject, Injectable } from '@nestjs/common';
import type {
  EnrollLeagueTeamsRequest,
  ParsedCreateLeagueSeasonRequest,
  SetCurrentSeasonRequest,
  UpdateLeagueSeasonRequest
} from '@efm/contracts';
import type { LeagueSeason, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from './admin-authorization.service.js';
import { AdminError } from './admin.errors.js';
import { AdminMutationReceiptService } from './admin-mutation-receipt.service.js';
import { AuditLogService } from './audit-log.service.js';

const SEASON_INCLUDE = {
  _count: { select: { entries: true } },
  entries: { where: { status: 'APPROVED' }, select: { id: true } }
} satisfies Prisma.LeagueSeasonInclude;
type SeasonRecord = Prisma.LeagueSeasonGetPayload<{ include: typeof SEASON_INCLUDE }>;

@Injectable()
export class AdminLeagueSeasonsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async list(actorAdminId: string, leagueId: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    const seasons = await this.prisma.leagueSeason.findMany({
      where: { leagueId },
      include: SEASON_INCLUDE,
      orderBy: [{ seasonNumber: 'desc' }, { id: 'asc' }]
    });
    return { items: seasons.map((season) => this.summary(season)), nextCursor: null };
  }

  async create(
    actorAdminId: string,
    leagueId: string,
    input: ParsedCreateLeagueSeasonRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.league-season.create:${leagueId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`;
        const league = await transaction.league.findUnique({ where: { id: leagueId } });
        if (!league) throw new AdminError('LEAGUE_NOT_FOUND', 'League was not found', 404);
        const previous = await transaction.leagueSeason.findFirst({
          where: { leagueId },
          orderBy: { seasonNumber: 'desc' }
        });
        const expectedNumber = previous ? previous.seasonNumber + 1 : 1;
        if (input.seasonNumber !== expectedNumber) {
          throw new AdminError('SEASON_NUMBER_INVALID', `The next season number must be ${expectedNumber}`, 409);
        }
        const season = await transaction.leagueSeason.create({
          data: {
            leagueId,
            seasonNumber: input.seasonNumber,
            displayName: input.displayName,
            previousSeasonId: previous?.id ?? null,
            isFirstSeason: previous === null,
            registrationOpensAt: new Date(input.registrationOpensAt),
            registrationClosesAt: new Date(input.registrationClosesAt),
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            superCapacity: input.superCapacity ?? league.defaultSuperCapacity,
            championCapacity: input.championCapacity ?? league.defaultChampionCapacity,
            promotionCount: input.promotionCount ?? league.defaultPromotionCount,
            createdByAdminId: actorAdminId
          },
          include: SEASON_INCLUDE
        });
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.league-season.create',
          resourceType: 'LeagueSeason',
          resourceId: season.id,
          metadata: { seasonNumber: season.seasonNumber, displayName: season.displayName }
        });
        return this.summary(season);
      },
      input
    );
  }

  async update(
    actorAdminId: string,
    leagueId: string,
    seasonId: string,
    input: UpdateLeagueSeasonRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.league-season.update:${seasonId}`,
      key,
      async (transaction) => {
        const existing = await this.seasonInLeague(transaction, leagueId, seasonId);
        if (existing.status !== 'DRAFT') {
          throw new AdminError('SEASON_FIELDS_LOCKED', 'Season fields are locked after registration opens', 409);
        }
        const result = await transaction.leagueSeason.updateMany({
          where: { id: seasonId, leagueId, version: input.expectedVersion },
          data: {
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.registrationOpensAt !== undefined ? { registrationOpensAt: new Date(input.registrationOpensAt) } : {}),
            ...(input.registrationClosesAt !== undefined ? { registrationClosesAt: new Date(input.registrationClosesAt) } : {}),
            ...(input.startsAt !== undefined ? { startsAt: new Date(input.startsAt) } : {}),
            ...(input.endsAt !== undefined ? { endsAt: new Date(input.endsAt) } : {}),
            ...(input.superCapacity !== undefined ? { superCapacity: input.superCapacity } : {}),
            ...(input.championCapacity !== undefined ? { championCapacity: input.championCapacity } : {}),
            ...(input.promotionCount !== undefined ? { promotionCount: input.promotionCount } : {}),
            version: { increment: 1 }
          }
        });
        if (result.count !== 1) throw this.versionConflict();
        const updated = await this.getRecord(transaction, seasonId);
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.league-season.update',
          resourceType: 'LeagueSeason',
          resourceId: seasonId,
          metadata: Object.fromEntries(Object.entries(input).filter(([name]) => name !== 'expectedVersion'))
        });
        return this.summary(updated);
      },
      input
    );
  }

  async setCurrent(
    actorAdminId: string,
    leagueId: string,
    seasonId: string,
    input: SetCurrentSeasonRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.league-season.set-current:${leagueId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`;
        const [league, season] = await Promise.all([
          transaction.league.findUnique({ where: { id: leagueId } }),
          transaction.leagueSeason.findUnique({ where: { id: seasonId } })
        ]);
        if (!league) throw new AdminError('LEAGUE_NOT_FOUND', 'League was not found', 404);
        if (!season || season.leagueId !== leagueId) {
          throw new AdminError('SEASON_NOT_IN_LEAGUE', 'Season does not belong to this league', 409);
        }
        const result = await transaction.league.updateMany({
          where: { id: leagueId, version: input.expectedVersion },
          data: { currentSeasonId: seasonId, version: { increment: 1 } }
        });
        if (result.count !== 1) throw this.versionConflict();
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.league-season.set-current',
          resourceType: 'League',
          resourceId: leagueId,
          metadata: { oldSeasonId: league.currentSeasonId, newSeasonId: seasonId }
        });
        return { leagueId, currentSeasonId: seasonId, version: input.expectedVersion + 1 };
      },
      input
    );
  }

  async enrollTeams(
    actorAdminId: string,
    leagueId: string,
    seasonId: string,
    input: EnrollLeagueTeamsRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.league-season.enroll-teams:${seasonId}`,
      key,
      async (transaction) => {
        const season = await this.seasonInLeague(transaction, leagueId, seasonId);
        const league = await transaction.league.findUnique({ where: { id: leagueId } });
        if (!league) throw new AdminError('LEAGUE_NOT_FOUND', 'League was not found', 404);
        const teams = await transaction.leagueTeam.findMany({
          where: { id: { in: input.leagueTeamIds }, leagueId, status: 'ACTIVE' }
        });
        if (teams.length !== input.leagueTeamIds.length) {
          throw new AdminError(
            'LEAGUE_TEAM_INVALID',
            'Every requested team must be an active member of this league',
            409
          );
        }
        const versionResult = await transaction.leagueSeason.updateMany({
          where: { id: seasonId, leagueId, version: input.expectedSeasonVersion },
          data: { version: { increment: 1 } }
        });
        if (versionResult.count !== 1) throw this.versionConflict();
        const now = new Date();
        const created = await transaction.seasonEntry.createMany({
          data: teams.map((team) => ({
            seasonId,
            teamProfileId: null,
            leagueTeamId: team.id,
            ownerUserId: team.ownerUserId,
            gameAccountId: null,
            source: 'RENEWAL' as const,
            status: 'APPROVED' as const,
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
          })),
          skipDuplicates: true
        });
        const approvedEntryCount = await transaction.seasonEntry.count({
          where: { seasonId, status: 'APPROVED' }
        });
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.league-season.enroll-teams',
          resourceType: 'LeagueSeason',
          resourceId: seasonId,
          metadata: {
            requestedTeamIds: input.leagueTeamIds,
            enrolledCount: created.count,
            oldSeasonVersion: season.version,
            newSeasonVersion: season.version + 1
          }
        });
        return {
          seasonId,
          enrolledCount: created.count,
          approvedEntryCount,
          version: input.expectedSeasonVersion + 1
        };
      },
      input
    );
  }

  private async seasonInLeague(
    transaction: Prisma.TransactionClient,
    leagueId: string,
    seasonId: string
  ): Promise<LeagueSeason> {
    const season = await transaction.leagueSeason.findUnique({ where: { id: seasonId } });
    if (!season || season.leagueId !== leagueId) {
      throw new AdminError('SEASON_NOT_IN_LEAGUE', 'Season does not belong to this league', 409);
    }
    return season;
  }

  private async getRecord(transaction: Prisma.TransactionClient, seasonId: string) {
    const season = await transaction.leagueSeason.findUnique({
      where: { id: seasonId },
      include: SEASON_INCLUDE
    });
    if (!season) throw new AdminError('SEASON_NOT_FOUND', 'Season was not found', 404);
    return season;
  }

  private summary(season: SeasonRecord) {
    return {
      id: season.id,
      leagueId: season.leagueId,
      seasonNumber: season.seasonNumber,
      displayName: season.displayName,
      previousSeasonId: season.previousSeasonId,
      isFirstSeason: season.isFirstSeason,
      registrationOpensAt: season.registrationOpensAt.toISOString(),
      registrationClosesAt: season.registrationClosesAt.toISOString(),
      startsAt: season.startsAt.toISOString(),
      endsAt: season.endsAt.toISOString(),
      superCapacity: season.superCapacity,
      championCapacity: season.championCapacity,
      promotionCount: season.promotionCount,
      status: season.status,
      entryCount: season._count.entries,
      approvedEntryCount: season.entries.length,
      version: season.version,
      createdAt: season.createdAt.toISOString(),
      updatedAt: season.updatedAt.toISOString()
    };
  }

  private versionConflict(): AdminError {
    return new AdminError('VERSION_CONFLICT', 'Resource has changed', 409);
  }
}
