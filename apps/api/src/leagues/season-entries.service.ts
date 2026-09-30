import { Inject, Injectable } from '@nestjs/common';
import type {
  ConfirmSeasonRenewalRequest,
  CreateSeasonApplicationRequest,
  OverrideSeasonEntryRequest,
  ReviewSeasonEntryRequest,
  SeasonEntryListQuery,
  SeasonEntryResponse,
  SeasonEntryStatus,
  WithdrawSeasonEntryRequest
} from '@efm/contracts';
import type { GameAccount, League, LeagueSeason, LeagueTeam, SeasonEntry } from '../generated/prisma/client.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError, assertLeagueExpectedVersion } from './league.errors.js';
import type { LeagueTransaction } from './league.types.js';

type SeasonWithLeague = LeagueSeason & { league: League };

@Injectable()
export class SeasonEntriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService
  ) {}

  apply(
    userId: string,
    seasonId: string,
    input: CreateSeasonApplicationRequest,
    key: string
  ): Promise<SeasonEntryResponse> {
    return this.receipts.execute(userId, `season.entry.apply:${seasonId}`, key, async (transaction) => {
      const season = await this.lockAndGetSeason(transaction, seasonId);
      this.assertRegistrationOpen(season);
      const identity = await this.identity(transaction, userId, input.gameAccountId, season.league);
      const existing = await transaction.seasonEntry.findUnique({
        where: { seasonId_leagueTeamId: { seasonId, leagueTeamId: identity.team.id } }
      });
      if (existing) {
        throw new LeagueError(
          'SEASON_ENTRY_ALREADY_EXISTS',
          existing.source === 'RENEWAL'
            ? 'Confirm the renewal invitation instead of creating a new application'
            : 'A season entry already exists for this team',
          409
        );
      }
      const entry = await transaction.seasonEntry.create({
        data: {
          seasonId,
          teamProfileId: identity.legacyTeamProfileId,
          leagueTeamId: identity.team.id,
          ownerUserId: userId,
          gameAccountId: identity.account.id,
          source: 'NEW_APPLICATION',
          status: 'PENDING',
          ...this.snapshot(identity.team, identity.account)
        }
      });
      await this.history(transaction, entry.id, null, 'PENDING', userId);
      return this.response(entry);
    });
  }

  confirmRenewal(
    userId: string,
    seasonId: string,
    input: ConfirmSeasonRenewalRequest,
    key: string
  ): Promise<SeasonEntryResponse> {
    return this.receipts.execute(userId, `season.entry.renew:${seasonId}`, key, async (transaction) => {
      const season = await this.lockAndGetSeason(transaction, seasonId);
      this.assertRegistrationOpen(season);
      const entry = await transaction.seasonEntry.findFirst({
        where: { seasonId, ownerUserId: userId }
      });
      if (!entry) throw this.notFound();
      assertLeagueExpectedVersion(entry.version, input.expectedVersion, 'Season entry');
      if (entry.source !== 'RENEWAL' || entry.status !== 'INVITED') {
        throw new LeagueError('SEASON_ENTRY_STATE_INVALID', 'Renewal invitation cannot be confirmed', 409);
      }
      const identity = await this.identity(transaction, userId, input.gameAccountId, season.league);
      if (identity.team.id !== entry.leagueTeamId) throw this.notFound();
      const now = new Date();
      const updated = await transaction.seasonEntry.updateMany({
        where: { id: entry.id, version: input.expectedVersion },
        data: {
          gameAccountId: identity.account.id,
          status: 'APPROVED',
          ...this.snapshot(identity.team, identity.account),
          confirmedAt: now,
          reviewedById: null,
          reviewedAt: null,
          decisionReason: null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await this.history(transaction, entry.id, 'INVITED', 'APPROVED', userId);
      return this.response(await transaction.seasonEntry.findUniqueOrThrow({ where: { id: entry.id } }));
    });
  }

  withdraw(
    userId: string,
    seasonId: string,
    input: WithdrawSeasonEntryRequest,
    key: string
  ): Promise<SeasonEntryResponse> {
    return this.receipts.execute(userId, `season.entry.withdraw:${seasonId}`, key, async (transaction) => {
      const season = await this.lockAndGetSeason(transaction, seasonId);
      this.assertRegistrationOpen(season);
      const entry = await transaction.seasonEntry.findFirst({ where: { seasonId, ownerUserId: userId } });
      if (!entry) throw this.notFound();
      assertLeagueExpectedVersion(entry.version, input.expectedVersion, 'Season entry');
      if (!['INVITED', 'PENDING', 'APPROVED'].includes(entry.status)) {
        throw new LeagueError('SEASON_ENTRY_STATE_INVALID', 'Season entry cannot be withdrawn', 409);
      }
      const updated = await transaction.seasonEntry.updateMany({
        where: { id: entry.id, version: input.expectedVersion },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date(), version: { increment: 1 } }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await this.history(transaction, entry.id, entry.status, 'WITHDRAWN', userId);
      return this.response(await transaction.seasonEntry.findUniqueOrThrow({ where: { id: entry.id } }));
    });
  }

  review(
    actorId: string,
    seasonId: string,
    entryId: string,
    input: ReviewSeasonEntryRequest,
    key: string
  ): Promise<SeasonEntryResponse> {
    return this.receipts.execute(actorId, `season.entry.review:${entryId}`, key, async (transaction) => {
      const season = await this.lockAndGetSeason(transaction, seasonId);
      this.assertReviewOpen(season);
      const entry = await transaction.seasonEntry.findFirst({ where: { id: entryId, seasonId } });
      if (!entry) throw this.notFound();
      assertLeagueExpectedVersion(entry.version, input.expectedVersion, 'Season entry');
      if (entry.status !== 'PENDING') {
        throw new LeagueError('SEASON_ENTRY_STATE_INVALID', 'Season entry is not pending review', 409);
      }
      const target: SeasonEntryStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const reason = input.reason?.trim() || null;
      if (target === 'REJECTED' && !reason) {
        throw new LeagueError('SEASON_ENTRY_REJECTION_REASON_REQUIRED', 'Rejection reason is required', 400);
      }
      return this.changeStatus(transaction, entry, target, actorId, reason);
    });
  }

  override(
    actorId: string,
    seasonId: string,
    entryId: string,
    input: OverrideSeasonEntryRequest,
    key: string
  ): Promise<SeasonEntryResponse> {
    return this.receipts.execute(actorId, `season.entry.override:${entryId}`, key, async (transaction) => {
      await this.lockAndGetSeason(transaction, seasonId);
      const reason = input.reason.trim();
      if (!reason) {
        throw new LeagueError(
          'SEASON_ENTRY_OVERRIDE_REASON_REQUIRED',
          'Override reason is required',
          400
        );
      }
      const entry = await transaction.seasonEntry.findFirst({ where: { id: entryId, seasonId } });
      if (!entry) throw this.notFound();
      assertLeagueExpectedVersion(entry.version, input.expectedVersion, 'Season entry');
      if (['REJECTED', 'WITHDRAWN'].includes(entry.status) || entry.status === input.targetStatus) {
        throw new LeagueError('SEASON_ENTRY_STATE_INVALID', 'Season entry cannot be overridden', 409);
      }
      return this.changeStatus(transaction, entry, input.targetStatus, actorId, reason);
    });
  }

  async getMine(userId: string, seasonId: string): Promise<SeasonEntryResponse | null> {
    const entry = await this.prisma.seasonEntry.findFirst({ where: { seasonId, ownerUserId: userId } });
    return entry ? this.response(entry) : null;
  }

  async listForManager(
    seasonId: string,
    query: SeasonEntryListQuery
  ): Promise<SeasonEntryResponse[]> {
    const entries = await this.prisma.seasonEntry.findMany({
      where: {
        seasonId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.source ? { source: query.source } : {})
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    return entries.map((entry) => this.response(entry));
  }

  private async changeStatus(
    transaction: LeagueTransaction,
    entry: SeasonEntry,
    target: SeasonEntryStatus,
    actorId: string,
    reason: string | null
  ): Promise<SeasonEntryResponse> {
    const now = new Date();
    const updated = await transaction.seasonEntry.updateMany({
      where: { id: entry.id, version: entry.version },
      data: {
        status: target,
        reviewedById: actorId,
        reviewedAt: now,
        decisionReason: reason,
        ...(target === 'WITHDRAWN' ? { withdrawnAt: now } : {}),
        version: { increment: 1 }
      }
    });
    if (updated.count !== 1) throw this.versionConflict();
    await this.history(transaction, entry.id, entry.status, target, actorId, reason);
    return this.response(await transaction.seasonEntry.findUniqueOrThrow({ where: { id: entry.id } }));
  }

  private async identity(
    transaction: LeagueTransaction,
    userId: string,
    gameAccountId: string,
    league: League
  ) {
    const team = await transaction.leagueTeam.findUnique({
      where: { leagueId_ownerUserId: { leagueId: league.id, ownerUserId: userId } }
    });
    if (!team || team.status !== 'ACTIVE' || team.teamNumber === null) {
      throw new LeagueError('LEAGUE_TEAM_REQUIRED', 'An active numbered league team is required', 409);
    }
    const account = await transaction.gameAccount.findFirst({
      where: { id: gameAccountId, userId }
    });
    if (!account) {
      throw new LeagueError('GAME_ACCOUNT_NOT_OWNED', 'The selected game account is not owned by this user', 404);
    }
    if (account.platform !== league.defaultPlatform || account.serverRegion !== league.defaultServerRegion) {
      throw new LeagueError(
        'GAME_ACCOUNT_INELIGIBLE',
        'Game account does not match league platform and server eligibility',
        409
      );
    }
    const legacyProfile = await transaction.teamProfile.findUnique({
      where: { ownerUserId: userId },
      select: { id: true }
    });
    return { team, account, legacyTeamProfileId: legacyProfile?.id ?? null };
  }

  private snapshot(
    team: Pick<LeagueTeam, 'teamNumber' | 'name' | 'shortName' | 'logoUrl'>,
    account: Pick<GameAccount, 'platform' | 'serverRegion' | 'gamerTag' | 'gameUid'>
  ) {
    return {
      teamNameSnapshot: team.name,
      teamShortNameSnapshot: team.shortName,
      teamNumberSnapshot: team.teamNumber,
      teamLogoUrlSnapshot: team.logoUrl,
      gamePlatformSnapshot: account.platform,
      serverRegionSnapshot: account.serverRegion,
      gamerTagSnapshot: account.gamerTag,
      gameUidSnapshot: account.gameUid
    };
  }

  private async lockAndGetSeason(
    transaction: LeagueTransaction,
    seasonId: string
  ): Promise<SeasonWithLeague> {
    await transaction.$queryRaw`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`;
    const season = await transaction.leagueSeason.findUnique({
      where: { id: seasonId },
      include: { league: true }
    });
    if (!season) throw new LeagueError('SEASON_NOT_FOUND', 'League season was not found', 404);
    return season;
  }

  private assertRegistrationOpen(season: LeagueSeason): void {
    const now = Date.now();
    if (
      season.status !== 'REGISTRATION_OPEN'
      || now < season.registrationOpensAt.getTime()
      || now >= season.registrationClosesAt.getTime()
    ) {
      throw new LeagueError('SEASON_REGISTRATION_CLOSED', 'Season registration is closed', 409);
    }
  }

  private assertReviewOpen(season: LeagueSeason): void {
    if (!['REGISTRATION_OPEN', 'ALLOCATION_REVIEW'].includes(season.status)) {
      throw new LeagueError('SEASON_REVIEW_CLOSED', 'Season entries cannot be reviewed', 409);
    }
  }

  private history(
    transaction: LeagueTransaction,
    entryId: string,
    fromStatus: SeasonEntryStatus | null,
    toStatus: SeasonEntryStatus,
    actorId: string,
    reason?: string | null
  ) {
    return transaction.seasonEntryStatusHistory.create({
      data: {
        seasonEntryId: entryId,
        fromStatus,
        toStatus,
        actorId,
        reason: reason?.trim() || null
      }
    });
  }

  private response(entry: SeasonEntry): SeasonEntryResponse {
    return {
      id: entry.id,
      seasonId: entry.seasonId,
      teamProfileId: entry.teamProfileId,
      leagueTeamId: entry.leagueTeamId,
      ownerUserId: entry.ownerUserId,
      gameAccountId: entry.gameAccountId,
      source: entry.source,
      status: entry.status,
      previousSeasonEntryId: entry.previousSeasonEntryId,
      teamNameSnapshot: entry.teamNameSnapshot,
      teamShortNameSnapshot: entry.teamShortNameSnapshot,
      teamNumberSnapshot: entry.teamNumberSnapshot,
      teamLogoUrlSnapshot: entry.teamLogoUrlSnapshot,
      gamePlatformSnapshot: entry.gamePlatformSnapshot,
      serverRegionSnapshot: entry.serverRegionSnapshot,
      gamerTagSnapshot: entry.gamerTagSnapshot,
      gameUidSnapshot: entry.gameUidSnapshot,
      leagueEditionSnapshot: entry.leagueEditionSnapshot,
      reviewedById: entry.reviewedById,
      reviewedAt: entry.reviewedAt?.toISOString() ?? null,
      decisionReason: entry.decisionReason,
      confirmedAt: entry.confirmedAt?.toISOString() ?? null,
      withdrawnAt: entry.withdrawnAt?.toISOString() ?? null,
      version: entry.version,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString()
    };
  }

  private notFound(): LeagueError {
    return new LeagueError('SEASON_ENTRY_NOT_FOUND', 'Season entry was not found', 404);
  }

  private versionConflict(): LeagueError {
    return new LeagueError('VERSION_CONFLICT', 'Season entry has changed', 409);
  }
}
