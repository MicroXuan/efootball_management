import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  PlayerAcquisitionApplication,
  PlayerApplicationListQuery,
  PlayerApplicationListResponse,
  PlayerMarketAnnouncementListResponse,
  PlayerMarketAnnouncementQuery,
  PlayerMarketListResponse,
  PlayerMarketPlayerDetail,
  PlayerMarketPlayerSummary,
  PlayerMarketQuery,
  PlayerMarketTeamSummary
} from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { playerMarketError } from './player-market.errors.js';
import { PlayerMarketAccessService, type ParticipantScope } from './player-market-access.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { PlayerMarketLockRepository } from './player-market-lock.repository.js';
import { expireClosedPlayerApplications } from './player-market-application-reconciliation.js';

export type MarketActionContext = {
  owned: boolean;
  ownedByMe: boolean;
  rosterCount: number;
  rosterStatus: 'COMPLIANT' | 'OVER_CAP';
  windowOpen: boolean;
  releasedByMe: boolean;
};

export function resolvePlayerMarketAction(context: MarketActionContext): {
  action: 'APPLY' | 'FORCE_SIGN' | 'OWNED_BY_ME' | 'DISABLED';
  disabledReason: string | null;
} {
  if (context.ownedByMe) return { action: 'OWNED_BY_ME', disabledReason: null };
  if (context.rosterCount >= 25) return { action: 'DISABLED', disabledReason: 'ROSTER_CAPACITY_REACHED' };
  if (!context.windowOpen) return { action: 'DISABLED', disabledReason: 'TRANSFER_WINDOW_CLOSED' };
  if (context.rosterStatus !== 'COMPLIANT') return { action: 'DISABLED', disabledReason: 'ROSTER_NON_COMPLIANT' };
  if (context.releasedByMe) return { action: 'DISABLED', disabledReason: 'RELEASED_BY_TEAM_IN_WINDOW' };
  return { action: context.owned ? 'FORCE_SIGN' : 'APPLY', disabledReason: null };
}

type ApplicationRow = Prisma.PlayerAcquisitionApplicationGetPayload<{
  include: {
    applicantLeagueTeam: true;
    sourceLeagueTeam: true;
    footballPlayer: true;
    playerCard: { include: { autoBuilds: true } };
    events: { include: { actorUser: true; actorAdmin: true } };
  };
}>;

type MarketPlayerRow = Prisma.FootballPlayerGetPayload<{
  include: { bestCard: { include: { playerCard: true; autoBuild: true } } };
}>;

@Injectable()
export class PlayerMarketQueryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerMarketAccessService) private readonly access: PlayerMarketAccessService,
    @Optional() private readonly clock: () => Date = () => new Date(),
    @Optional() @Inject(AdminAuthorizationService) private readonly authorization?: AdminAuthorizationService,
    @Optional() @Inject(PlayerMarketLockRepository) private readonly locks?: PlayerMarketLockRepository
  ) {}

  static encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url');
  }

  static decodeCursor(cursor: string): { createdAt: Date; id: string } {
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string') {
        throw new Error('invalid cursor');
      }
      const createdAt = new Date(value[0]);
      if (Number.isNaN(createdAt.getTime())) throw new Error('invalid cursor');
      return { createdAt, id: value[1] };
    } catch {
      throw playerMarketError('PLAYER_MARKET_CURSOR_INVALID', '分页游标无效', 400);
    }
  }

  async listMarket(userId: string, leagueId: string, query: PlayerMarketQuery): Promise<PlayerMarketListResponse> {
    const scope = await this.access.requireParticipant(userId, leagueId, query.seasonId);
    const now = this.clock();
    const cursor = query.cursor ? PlayerMarketQueryService.decodeCursor(query.cursor) : null;
    const keyword = query.keyword?.trim();
    const filters: Prisma.FootballPlayerWhereInput[] = [
      { publishedAt: { not: null } },
      ...(keyword ? [{ OR: [
        { nameZh: { contains: keyword } },
        { nameEn: { contains: keyword } },
        { shortName: { contains: keyword } },
        { club: { contains: keyword } },
        { clubZh: { contains: keyword } },
        { clubEn: { contains: keyword } }
      ] } as Prisma.FootballPlayerWhereInput] : []),
      ...(query.position ? [{ cards: { some: { position: query.position, status: 'ACTIVE' } } } as Prisma.FootballPlayerWhereInput] : []),
      ...(query.ownership === 'FREE' ? [{
        leagueOwnerships: { none: { leagueId, status: 'ACTIVE' } }
      } as Prisma.FootballPlayerWhereInput] : []),
      ...(query.ownership === 'OWNED' ? [{
        leagueOwnerships: { some: { leagueId, status: 'ACTIVE' } }
      } as Prisma.FootballPlayerWhereInput] : []),
      ...(cursor ? [{ OR: [
        { AND: [{ createdAt: { equals: cursor.createdAt } }, { id: { gt: cursor.id } }] },
        { createdAt: { gt: cursor.createdAt } }
      ] } as Prisma.FootballPlayerWhereInput] : [])
    ];
    const playerWhere: Prisma.FootballPlayerWhereInput = { AND: filters };
    const players = await this.prisma.footballPlayer.findMany({
      where: playerWhere,
      include: { bestCard: { include: { playerCard: true, autoBuild: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1
    });
    const page = players.slice(0, query.limit);
    const result = await this.marketPlayers(scope, leagueId, query.seasonId, page, now);
    const last = page.at(-1);
    return {
      ...result,
      nextCursor: players.length > query.limit && last ? PlayerMarketQueryService.encodeCursor(last.createdAt, last.id) : null
    };
  }

  async detail(userId: string, leagueId: string, playerId: string, seasonId: string): Promise<PlayerMarketPlayerDetail> {
    const scope = await this.access.requireParticipant(userId, leagueId, seasonId);
    const player = await this.prisma.footballPlayer.findFirst({
      where: { id: playerId, publishedAt: { not: null } },
      include: { bestCard: { include: { playerCard: true, autoBuild: true } } }
    });
    if (!player) throw playerMarketError('FOOTBALL_PLAYER_NOT_FOUND', '球员不存在', 404);
    const result = await this.marketPlayers(scope, leagueId, seasonId, [player], this.clock());
    const summary = result.items[0];
    if (!summary) throw playerMarketError('FOOTBALL_PLAYER_NOT_FOUND', '球员不存在', 404);
    const applications = await this.listApplications(userId, leagueId, { seasonId, playerId, scope: 'PUBLIC', limit: 100 });
    return {
      ...summary,
      activeTransferWindowId: result.activeTransferWindowId,
      myApplication: applications.items.find((item) => item.applicantTeam.teamId === scope.leagueTeamId) ?? null,
      publicApplications: applications.items
    };
  }

  private async marketPlayers(
    scope: ParticipantScope,
    leagueId: string,
    seasonId: string,
    page: MarketPlayerRow[],
    now: Date
  ): Promise<{ items: PlayerMarketPlayerSummary[]; activeTransferWindowId: string | null }> {
    const playerIds = page.map(({ id }) => id);
    const [ownerships, valuations, window, rosterCount, salaryRule] = await Promise.all([
      this.prisma.leaguePlayerOwnership.findMany({
        where: { leagueId, footballPlayerId: { in: playerIds }, status: 'ACTIVE' },
        include: { leagueTeam: true, currentPlayerCard: { include: { autoBuilds: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } }
      }),
      this.prisma.leaguePlayerValuation.findMany({ where: { leagueId, footballPlayerId: { in: playerIds } } }),
      this.prisma.transferWindow.findFirst({
        where: { seasonId, allowBuy: true, startsAt: { lte: now }, endsAt: { gt: now } },
        orderBy: [{ startsAt: 'desc' }, { id: 'asc' }]
      }),
      this.prisma.leaguePlayerOwnership.count({ where: { leagueTeamId: scope.leagueTeamId, status: 'ACTIVE' } }),
      this.prisma.leagueSalaryRuleVersion.findFirst({ where: { leagueId, status: 'ACTIVE', effectiveAt: { lte: now } }, include: { tiers: true }, orderBy: { version: 'desc' } })
    ]);
    const restrictions = window ? await this.prisma.playerReleaseRestriction.findMany({
      where: { transferWindowId: window.id, leagueTeamId: scope.leagueTeamId, footballPlayerId: { in: playerIds } },
      select: { footballPlayerId: true }
    }) : [];
    const ownershipByPlayer = new Map(ownerships.map((row) => [row.footballPlayerId, row]));
    const valuationByPlayer = new Map(valuations.map((row) => [row.footballPlayerId, row]));
    const restrictedPlayers = new Set(restrictions.map(({ footballPlayerId }) => footballPlayerId));

    const items = page.map((player) => {
      const ownership = ownershipByPlayer.get(player.id);
      const valuation = valuationByPlayer.get(player.id);
      const selectedCard = ownership?.currentPlayerCard ?? player.bestCard?.playerCard ?? null;
      const maxOverall = ownership?.maxOverallSnapshot ?? player.bestCard?.autoBuild.maxOverall ?? selectedCard?.overallRating ?? null;
      const salaryMinor = ownership?.salaryMinor ?? this.salaryFor(maxOverall, salaryRule?.tiers ?? []);
      const action = resolvePlayerMarketAction({
        owned: Boolean(ownership),
        ownedByMe: ownership?.leagueTeamId === scope.leagueTeamId,
        rosterCount,
        rosterStatus: scope.rosterStatus,
        windowOpen: Boolean(window),
        releasedByMe: restrictedPlayers.has(player.id)
      });
      return {
        playerId: player.id,
        playerName: player.nameZh ?? player.nameEn ?? player.shortName ?? '未命名球员',
        nationality: player.nationality,
        club: player.club,
        currentOwner: ownership ? this.team(ownership.leagueTeam) : null,
        ownershipId: ownership?.id ?? null,
        ownershipVersion: ownership?.version ?? null,
        officialValueMinor: valuation?.currentValueMinor ?? null,
        valuationVersion: valuation?.version ?? null,
        card: selectedCard ? {
          playerCardId: selectedCard.id,
          cardName: selectedCard.cardName,
          imageUrl: selectedCard.imageUrl,
          position: selectedCard.position,
          maxOverall,
          salaryMinor
        } : null,
        forcedTransferBadge: ownership?.acquisitionType === 'FORCED_TRANSFER' && ownership.acquisitionSeasonId === seasonId,
        ...action
      };
    });
    return {
      items,
      activeTransferWindowId: window?.id ?? null
    };
  }

  async listApplications(userId: string, leagueId: string, query: PlayerApplicationListQuery): Promise<PlayerApplicationListResponse> {
    const scope = await this.access.requireParticipant(userId, leagueId, query.seasonId);
    return this.applicationList(leagueId, query, scope.leagueTeamId);
  }

  async listApplicationsForAdmin(adminId: string, leagueId: string, query: PlayerApplicationListQuery): Promise<PlayerApplicationListResponse> {
    if (!this.authorization) throw new Error('Admin authorization service is required');
    await this.authorization.requireLeagueManager(adminId, leagueId);
    return this.applicationList(leagueId, query, null);
  }

  private async applicationList(leagueId: string, query: PlayerApplicationListQuery, mineTeamId: string | null): Promise<PlayerApplicationListResponse> {
    await this.expireClosedApplications(leagueId, query.seasonId, this.clock());
    const cursor = query.cursor ? PlayerMarketQueryService.decodeCursor(query.cursor) : null;
    const rows = await this.prisma.playerAcquisitionApplication.findMany({
      where: {
        leagueId,
        seasonId: query.seasonId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.playerId ? { footballPlayerId: query.playerId } : {}),
        ...(query.scope === 'MINE' && mineTeamId ? { applicantLeagueTeamId: mineTeamId } : {}),
        ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {})
      },
      include: {
        applicantLeagueTeam: true,
        sourceLeagueTeam: true,
        footballPlayer: true,
        playerCard: { include: { autoBuilds: { orderBy: { calculatedAt: 'desc' }, take: 1 } } },
        events: { include: { actorUser: true, actorAdmin: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1
    });
    const page = rows.slice(0, query.limit);
    const forced = page.filter((row) => row.type === 'FORCED_TRANSFER' && row.status === 'PENDING');
    const queueById = new Map(forced
      .sort((a, b) => a.firstValidSubmittedAt.getTime() - b.firstValidSubmittedAt.getTime() || a.id.localeCompare(b.id))
      .map((row, index) => [row.id, index + 1]));
    const last = page.at(-1);
    return {
      items: page.map((row) => this.application(row, queueById.get(row.id) ?? null)),
      nextCursor: rows.length > query.limit && last ? PlayerMarketQueryService.encodeCursor(last.createdAt, last.id) : null
    };
  }

  private async expireClosedApplications(leagueId: string, seasonId: string, now: Date): Promise<void> {
    if (!this.locks) return;
    const candidates = await this.prisma.playerAcquisitionApplication.findMany({
      where: { leagueId, seasonId, status: { in: ['PENDING', 'REQUOTE_REQUIRED'] }, transferWindow: { endsAt: { lte: now } } },
      select: { id: true, footballPlayerId: true }
    });
    const playerIds = [...new Set(candidates.map(({ footballPlayerId }) => footballPlayerId))].sort();
    for (const footballPlayerId of playerIds) {
      await this.prisma.$transaction(async (tx) => {
        await this.locks!.lockSeason(tx, seasonId);
        await this.locks!.lockPlayer(tx, leagueId, footballPlayerId);
        const rows = await tx.playerAcquisitionApplication.findMany({ where: {
          leagueId, seasonId, footballPlayerId, status: { in: ['PENDING', 'REQUOTE_REQUIRED'] }, transferWindow: { endsAt: { lte: now } }
        }, select: { id: true, applicantLeagueTeamId: true, sourceLeagueTeamId: true, status: true, amountMinor: true } });
        await this.locks!.lockTeams(tx, rows.flatMap((row) => [row.applicantLeagueTeamId, row.sourceLeagueTeamId]));
        await this.locks!.lockApplicationsForPlayer(tx, leagueId, seasonId, footballPlayerId);
        await expireClosedPlayerApplications(tx, { leagueId, seasonId, footballPlayerId, at: now });
      });
    }
  }

  async listAnnouncements(userId: string, leagueId: string, query: PlayerMarketAnnouncementQuery): Promise<PlayerMarketAnnouncementListResponse> {
    await this.access.requireParticipant(userId, leagueId, query.seasonId);
    const cursor = query.cursor ? PlayerMarketQueryService.decodeCursor(query.cursor) : null;
    const rows = await this.prisma.rosterTransaction.findMany({
      where: {
        leagueId,
        seasonId: query.seasonId,
        type: { in: ['BUY', 'FORCED_TRANSFER', 'RELEASE'] },
        ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {})
      },
      include: { footballPlayer: true, sourceLeagueTeam: true, targetLeagueTeam: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => {
        const playerName = row.footballPlayer.nameZh ?? row.footballPlayer.nameEn ?? row.footballPlayer.shortName ?? '未命名球员';
        const kind = row.type === 'FORCED_TRANSFER'
          ? 'FORCED_TRANSFER' as const
          : row.type === 'RELEASE'
            ? 'RELEASE' as const
            : 'NORMAL_PURCHASE' as const;
        return {
          id: row.id,
          kind,
          playerId: row.footballPlayerId,
          playerName,
          sourceTeam: row.sourceLeagueTeam ? this.team(row.sourceLeagueTeam) : null,
          targetTeam: row.targetLeagueTeam ? this.team(row.targetLeagueTeam) : null,
          amountMinor: row.amountMinor,
          message: row.type === 'RELEASE' ? `${playerName} 已被下放` : `${playerName} 已完成${row.type === 'FORCED_TRANSFER' ? '强报' : '签约'}`,
          createdAt: row.createdAt.toISOString()
        };
      }),
      nextCursor: rows.length > query.limit && last ? PlayerMarketQueryService.encodeCursor(last.createdAt, last.id) : null
    };
  }

  private team(team: { id: string; teamNumber: number | null; name: string; logoUrl: string | null; ownerAlias: string }): PlayerMarketTeamSummary {
    return { teamId: team.id, teamNumber: team.teamNumber, name: team.name, logoUrl: team.logoUrl, ownerAlias: team.ownerAlias };
  }

  private salaryFor(overall: number | null, tiers: Array<{ minOverall: number; maxOverall: number; salaryMinor: number }>): number | null {
    if (overall === null) return null;
    return tiers.find((tier) => overall >= tier.minOverall && overall <= tier.maxOverall)?.salaryMinor ?? null;
  }

  private application(row: ApplicationRow, queuePosition: number | null): PlayerAcquisitionApplication {
    const build = row.playerCard.autoBuilds[0];
    return {
      id: row.id,
      leagueId: row.leagueId,
      seasonId: row.seasonId,
      transferWindowId: row.transferWindowId,
      type: row.type,
      applicantTeam: this.team(row.applicantLeagueTeam),
      playerId: row.footballPlayerId,
      playerName: row.footballPlayer.nameZh ?? row.footballPlayer.nameEn ?? row.footballPlayer.shortName ?? '未命名球员',
      playerCard: {
        playerCardId: row.playerCard.id,
        cardName: row.playerCard.cardName,
        imageUrl: row.playerCard.imageUrl,
        position: row.playerCard.position,
        maxOverall: build?.maxOverall ?? row.playerCard.overallRating,
        salaryMinor: null
      },
      sourceTeam: row.sourceLeagueTeam ? this.team(row.sourceLeagueTeam) : null,
      ownershipId: row.ownershipId,
      ownershipVersionSnapshot: row.ownershipVersionSnapshot,
      amountMinor: row.amountMinor,
      valuationMinorSnapshot: row.valuationMinorSnapshot,
      valuationVersionSnapshot: row.valuationVersionSnapshot,
      status: row.status,
      queuePosition,
      firstValidSubmittedAt: row.firstValidSubmittedAt.toISOString(),
      lastSubmittedAt: row.lastSubmittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewReason: row.reviewReason,
      version: row.version,
      events: row.events.map((event) => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        fromAmountMinor: event.fromAmountMinor,
        toAmountMinor: event.toAmountMinor,
        actorType: event.actorUserId ? 'USER' : event.actorAdminId ? 'ADMIN' : 'SYSTEM',
        actorDisplayName: event.actorUser?.displayName ?? event.actorAdmin?.displayName ?? '系统',
        reason: event.reason,
        createdAt: event.createdAt.toISOString()
      }))
    };
  }
}
