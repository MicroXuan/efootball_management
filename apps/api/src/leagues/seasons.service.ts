import { Inject, Injectable } from '@nestjs/common';
import {
  CreateLeagueSeasonRequestSchema,
  type LeagueSeasonDetail,
  type LeagueSeasonStatus,
  type LeagueSeasonSummary,
  type ParsedCreateLeagueSeasonRequest,
  type SeasonTransitionRequest,
  type UpdateLeagueSeasonRequest
} from '@efm/contracts';
import type { LeagueSeason, Prisma } from '../generated/prisma/client.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { assertSeasonTransition } from './domain/season-state.js';
import { LeagueError } from './league.errors.js';
import type { LeagueTransaction } from './league.types.js';

const SEASON_INCLUDE = {
  _count: { select: { entries: true } },
  entries: { where: { status: 'APPROVED' }, select: { id: true } }
} satisfies Prisma.LeagueSeasonInclude;
type SeasonRecord = Prisma.LeagueSeasonGetPayload<{ include: typeof SEASON_INCLUDE }>;
type TransitionInput = SeasonTransitionRequest & { reason?: string | undefined };

@Injectable()
export class SeasonsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService
  ) {}

  create(
    actorId: string,
    leagueId: string,
    input: ParsedCreateLeagueSeasonRequest,
    key: string
  ): Promise<LeagueSeasonDetail> {
    return this.receipts.execute(actorId, `season.create:${leagueId}`, key, async (transaction) => {
      const parsed = CreateLeagueSeasonRequestSchema.safeParse(input);
      if (!parsed.success) throw this.invalidTimeline();
      await transaction.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`;
      const league = await transaction.league.findUnique({ where: { id: leagueId } });
      if (!league) throw new LeagueError('LEAGUE_NOT_FOUND', 'League was not found', 404);
      const previous = await transaction.leagueSeason.findFirst({
        where: { leagueId },
        orderBy: { seasonNumber: 'desc' }
      });
      const expectedNumber = previous ? previous.seasonNumber + 1 : 1;
      if (parsed.data.seasonNumber !== expectedNumber) {
        throw new LeagueError(
          'SEASON_NUMBER_INVALID',
          `The next season number must be ${expectedNumber}`,
          409
        );
      }
      const season = await transaction.leagueSeason.create({
        data: {
          leagueId,
          seasonNumber: parsed.data.seasonNumber,
          displayName: parsed.data.displayName,
          previousSeasonId: previous?.id ?? null,
          isFirstSeason: previous === null,
          registrationOpensAt: new Date(parsed.data.registrationOpensAt),
          registrationClosesAt: new Date(parsed.data.registrationClosesAt),
          startsAt: new Date(parsed.data.startsAt),
          endsAt: new Date(parsed.data.endsAt),
          superCapacity: parsed.data.superCapacity ?? league.defaultSuperCapacity,
          championCapacity: parsed.data.championCapacity ?? league.defaultChampionCapacity,
          promotionCount: parsed.data.promotionCount ?? league.defaultPromotionCount,
          createdById: actorId
        }
      });
      await transaction.leagueSeasonStatusHistory.create({
        data: { seasonId: season.id, fromStatus: null, toStatus: 'DRAFT', actorId }
      });
      return this.getRecord(transaction, season.id).then((record) => this.detail(record, true));
    });
  }

  update(
    actorId: string,
    seasonId: string,
    input: UpdateLeagueSeasonRequest,
    key: string
  ): Promise<LeagueSeasonDetail> {
    return this.receipts.execute(actorId, `season.update:${seasonId}`, key, async (transaction) => {
      await this.lockSeason(transaction, seasonId);
      const existing = await transaction.leagueSeason.findUnique({ where: { id: seasonId } });
      if (!existing) throw this.notFound();
      if (existing.status !== 'DRAFT') {
        throw new LeagueError(
          'SEASON_FIELDS_LOCKED',
          'Season fields are locked after registration opens',
          409
        );
      }
      const merged = CreateLeagueSeasonRequestSchema.safeParse({
        seasonNumber: existing.seasonNumber,
        displayName: input.displayName ?? existing.displayName,
        registrationOpensAt: input.registrationOpensAt ?? existing.registrationOpensAt.toISOString(),
        registrationClosesAt: input.registrationClosesAt ?? existing.registrationClosesAt.toISOString(),
        startsAt: input.startsAt ?? existing.startsAt.toISOString(),
        endsAt: input.endsAt ?? existing.endsAt.toISOString(),
        superCapacity: input.superCapacity ?? existing.superCapacity,
        championCapacity: input.championCapacity ?? existing.championCapacity,
        promotionCount: input.promotionCount ?? existing.promotionCount
      });
      if (!merged.success) throw this.invalidTimeline();
      const updated = await transaction.leagueSeason.updateMany({
        where: { id: seasonId, version: input.expectedVersion },
        data: {
          displayName: merged.data.displayName,
          registrationOpensAt: new Date(merged.data.registrationOpensAt),
          registrationClosesAt: new Date(merged.data.registrationClosesAt),
          startsAt: new Date(merged.data.startsAt),
          endsAt: new Date(merged.data.endsAt),
          superCapacity: input.superCapacity ?? existing.superCapacity,
          championCapacity: input.championCapacity ?? existing.championCapacity,
          promotionCount: input.promotionCount ?? existing.promotionCount,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      return this.getRecord(transaction, seasonId).then((record) => this.detail(record, true));
    });
  }

  transition(
    actorId: string,
    seasonId: string,
    target: LeagueSeasonStatus,
    input: TransitionInput,
    key: string
  ): Promise<LeagueSeasonDetail> {
    return this.receipts.execute(actorId, `season.transition:${seasonId}:${target}`, key, async (transaction) => {
      await this.lockSeason(transaction, seasonId);
      const existing = await transaction.leagueSeason.findUnique({ where: { id: seasonId } });
      if (!existing) throw this.notFound();
      if (existing.version !== input.expectedVersion) throw this.versionConflict();
      assertSeasonTransition(existing.status, target);
      const reason = input.reason?.trim();
      if (target === 'CANCELLED' && !reason) {
        throw new LeagueError(
          'CANCELLATION_REASON_REQUIRED',
          'Cancellation reason is required',
          400
        );
      }

      if (target === 'REGISTRATION_OPEN') {
        await this.prepareRenewalInvitations(transaction, existing, actorId);
      }
      const updated = await transaction.leagueSeason.updateMany({
        where: { id: seasonId, version: input.expectedVersion },
        data: {
          status: target,
          ...(target === 'CANCELLED' ? { cancellationReason: reason! } : {}),
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await transaction.leagueSeasonStatusHistory.create({
        data: {
          seasonId,
          fromStatus: existing.status,
          toStatus: target,
          actorId,
          reason: reason ?? null
        }
      });
      return this.getRecord(transaction, seasonId).then((record) => this.detail(record, true));
    });
  }

  async listPublic(leagueId: string): Promise<LeagueSeasonSummary[]> {
    const seasons = await this.prisma.leagueSeason.findMany({
      where: { leagueId, status: { not: 'DRAFT' } },
      include: SEASON_INCLUDE,
      orderBy: [{ seasonNumber: 'desc' }, { id: 'asc' }]
    });
    return seasons.map((season) => this.summary(season));
  }

  async listManaged(leagueId: string): Promise<LeagueSeasonDetail[]> {
    const seasons = await this.prisma.leagueSeason.findMany({
      where: { leagueId },
      include: SEASON_INCLUDE,
      orderBy: [{ seasonNumber: 'desc' }, { id: 'asc' }]
    });
    return seasons.map((season) => this.detail(season, true));
  }

  async getPublic(seasonId: string): Promise<LeagueSeasonDetail> {
    const record = await this.getRecord(this.prisma, seasonId);
    if (record.status === 'DRAFT') throw this.notFound();
    return this.detail(record, false);
  }

  async getManaged(seasonId: string): Promise<LeagueSeasonDetail> {
    return this.detail(await this.getRecord(this.prisma, seasonId), true);
  }

  private async prepareRenewalInvitations(
    transaction: LeagueTransaction,
    season: LeagueSeason,
    actorId: string
  ): Promise<void> {
    if (!season.previousSeasonId) return;
    const previousEntries = await transaction.seasonEntry.findMany({
      where: { seasonId: season.previousSeasonId, status: 'APPROVED' },
      include: {
        gameAccount: true,
        leagueTeam: { include: { defaultGameAccount: true } }
      }
    });
    const existing = await transaction.seasonEntry.findMany({
      where: { seasonId: season.id },
      select: { leagueTeamId: true }
    });
    const existingTeams = new Set(existing.map((entry) => entry.leagueTeamId));

    for (const previous of previousEntries) {
      if (existingTeams.has(previous.leagueTeamId)) continue;
      const account = previous.leagueTeam.defaultGameAccount ?? previous.gameAccount;
      const invitation = await transaction.seasonEntry.create({
        data: {
          seasonId: season.id,
          teamProfileId: previous.teamProfileId,
          leagueTeamId: previous.leagueTeamId,
          ownerUserId: previous.ownerUserId,
          gameAccountId: account.id,
          source: 'RENEWAL',
          status: 'INVITED',
          previousSeasonEntryId: previous.id,
          teamNameSnapshot: previous.leagueTeam.name,
          teamShortNameSnapshot: previous.leagueTeam.shortName,
          teamNumberSnapshot: previous.leagueTeam.teamNumber,
          teamLogoUrlSnapshot: previous.leagueTeam.logoUrl,
          gamePlatformSnapshot: account.platform,
          serverRegionSnapshot: account.serverRegion,
          gamerTagSnapshot: account.gamerTag,
          gameUidSnapshot: account.gameUid
        }
      });
      await transaction.seasonEntryStatusHistory.create({
        data: {
          seasonEntryId: invitation.id,
          fromStatus: null,
          toStatus: 'INVITED',
          actorId,
          reason: 'Renewal invitation generated when registration opened'
        }
      });
      existingTeams.add(previous.leagueTeamId);
    }
  }

  private lockSeason(transaction: LeagueTransaction, seasonId: string): Promise<unknown> {
    return transaction.$queryRaw`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`;
  }

  private async getRecord(
    client: LeagueTransaction | PrismaService,
    seasonId: string
  ): Promise<SeasonRecord> {
    const record = await client.leagueSeason.findUnique({
      where: { id: seasonId },
      include: SEASON_INCLUDE
    });
    if (!record) throw this.notFound();
    return record;
  }

  private detail(record: SeasonRecord, canManage: boolean): LeagueSeasonDetail {
    return {
      ...this.summary(record),
      currentEntry: null,
      capabilities: {
        canManage,
        canReviewEntries: canManage,
        canApply: false,
        canConfirmRenewal: false,
        canWithdraw: false
      }
    };
  }

  private summary(record: SeasonRecord): LeagueSeasonSummary {
    return {
      id: record.id,
      leagueId: record.leagueId,
      seasonNumber: record.seasonNumber,
      displayName: record.displayName,
      previousSeasonId: record.previousSeasonId,
      isFirstSeason: record.isFirstSeason,
      registrationOpensAt: record.registrationOpensAt.toISOString(),
      registrationClosesAt: record.registrationClosesAt.toISOString(),
      startsAt: record.startsAt.toISOString(),
      endsAt: record.endsAt.toISOString(),
      superCapacity: record.superCapacity,
      championCapacity: record.championCapacity,
      promotionCount: record.promotionCount,
      status: record.status,
      entryCount: record._count.entries,
      approvedEntryCount: record.entries.length,
      version: record.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }

  private invalidTimeline(): LeagueError {
    return new LeagueError('SEASON_TIMELINE_INVALID', 'Season timeline is invalid', 400);
  }

  private notFound(): LeagueError {
    return new LeagueError('SEASON_NOT_FOUND', 'League season was not found', 404);
  }

  private versionConflict(): LeagueError {
    return new LeagueError('VERSION_CONFLICT', 'League season has changed', 409);
  }
}
