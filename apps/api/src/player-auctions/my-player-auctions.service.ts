import { Inject, Injectable } from '@nestjs/common';
import {
  AuctionPlayerCardSnapshotSchema,
  type MyPlayerAuctionListQuery,
  type MyPlayerAuctionSaleListQuery,
  type MyPlayerAuctionSaleListResponse,
  type PlaceMiniprogramAuctionBidRequest
} from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerAuctionError } from './player-auction.errors.js';
import { PlayerAuctionBidService } from './player-auction-bid.service.js';

const ACTIVE_STATUSES = ['READY', 'ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED'] as const;
const ROOM_INCLUDE = {
  league: { select: { id: true, name: true } },
  lots: {
    include: {
      currentHighestBid: {
        include: {
          leagueTeam: { select: { teamNumber: true, name: true } },
          user: { select: { displayName: true } }
        }
      },
      review: true,
      bids: {
        where: { result: 'VALID' as const },
        include: {
          leagueTeam: { select: { teamNumber: true, name: true } },
          user: { select: { displayName: true } }
        },
        orderBy: [{ submittedAt: 'desc' as const }, { id: 'desc' as const }]
      }
    },
    orderBy: [{ displayOrder: 'asc' as const }, { id: 'asc' as const }]
  }
};

@Injectable()
export class MyPlayerAuctionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerAuctionBidService) private readonly bids: PlayerAuctionBidService
  ) {}

  async list(userId: string, query: MyPlayerAuctionListQuery) {
    const teams = await this.prisma.leagueTeam.findMany({
      where: { ownerUserId: userId, status: 'ACTIVE' },
      select: { id: true, name: true, leagueId: true }
    });
    if (teams.length === 0) return { items: [] };
    const teamByLeague = new Map(teams.map((team) => [team.leagueId, team]));
    const batches = await this.prisma.playerAuctionBatch.findMany({
      where: {
        leagueId: { in: [...teamByLeague.keys()] },
        bidChannel: 'MINIPROGRAM',
        ...(query.status === 'active' ? { status: { in: [...ACTIVE_STATUSES] } } : {})
      },
      include: {
        league: { select: { id: true, name: true } },
        currentLot: { select: { id: true, playerNameSnapshot: true, deadlineAt: true } }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    return {
      items: batches.map((batch) => {
        const team = teamByLeague.get(batch.leagueId)!;
        return {
          batchId: batch.id,
          league: batch.league,
          team: { id: team.id, name: team.name },
          name: batch.name,
          status: batch.status,
          currentLotId: batch.currentLotId,
          currentPlayerName: batch.currentLot?.playerNameSnapshot ?? null,
          deadlineAt: batch.currentLot?.deadlineAt?.toISOString() ?? null,
          sharePath: this.sharePath(batch.id)
        };
      })
    };
  }

  async detail(userId: string, batchId: string) {
    const batch = await this.prisma.playerAuctionBatch.findFirst({
      where: { id: batchId, bidChannel: 'MINIPROGRAM' },
      include: ROOM_INCLUDE
    });
    if (!batch) throw new PlayerAuctionError('AUCTION_NOT_FOUND', '小程序拍卖不存在', 404);
    const team = await this.prisma.leagueTeam.findFirst({
      where: { ownerUserId: userId, leagueId: batch.leagueId, status: 'ACTIVE' }
    });
    const rows = await this.prisma.$queryRaw<Array<{ databaseNow: Date }>>`SELECT CURRENT_TIMESTAMP(3) AS databaseNow`;
    const serverNow = rows[0]?.databaseNow;
    if (!serverNow) throw new Error('DATABASE_TIME_UNAVAILABLE');
    const current = batch.lots.find((lot) => lot.id === batch.currentLotId) ?? null;
    return {
      batchId: batch.id,
      name: batch.name,
      status: batch.status,
      bidChannel: 'MINIPROGRAM' as const,
      serverNow: serverNow.toISOString(),
      league: batch.league,
      team: team ? { id: team.id, name: team.name } : null,
      canBid: Boolean(team && batch.status === 'ACTIVE' && current?.status === 'ACTIVE'),
      minimumValidPrice: current
        ? current.currentPrice === null
          ? current.startingPrice
          : current.currentPrice + current.minimumIncrement
        : null,
      currentLot: current ? this.lotView(current, true) : null,
      queue: batch.lots.filter((lot) => lot.id !== current?.id).map((lot) => this.lotView(lot, false)),
      sharePath: this.sharePath(batch.id)
    };
  }

  async listSales(userId: string, query: MyPlayerAuctionSaleListQuery): Promise<MyPlayerAuctionSaleListResponse> {
    const teams = await this.prisma.leagueTeam.findMany({
      where: { ownerUserId: userId, status: 'ACTIVE' },
      select: { leagueId: true }
    });
    const leagueIds = [...new Set(teams.map((team) => team.leagueId))];
    if (leagueIds.length === 0) return { items: [], nextCursor: null };

    const keyword = query.keyword?.trim();
    const numericTeamNumber = keyword && /^\d+$/.test(keyword) ? Number(keyword) : undefined;
    const rows = await this.prisma.playerAuctionReview.findMany({
      where: {
        decision: { in: ['CONFIRM', 'ADJUST'] },
        reviewedWinnerTeamId: { not: null },
        reviewedPrice: { not: null },
        winnerTeamNameSnapshot: { not: null },
        winnerDisplayNameSnapshot: { not: null },
        lot: { batch: { leagueId: { in: leagueIds } } },
        ...(keyword ? {
          OR: [
            { lot: { playerNameSnapshot: { contains: keyword } } },
            { winnerTeamNameSnapshot: { contains: keyword } },
            { winnerDisplayNameSnapshot: { contains: keyword } },
            ...(numericTeamNumber === undefined ? [] : [{ winnerTeamNumberSnapshot: numericTeamNumber }])
          ]
        } : {})
      },
      include: {
        lot: {
          include: {
            batch: { include: { league: { select: { id: true, name: true } } } },
            playerCard: { select: { id: true, imageUrl: true, cardName: true, position: true, overallRating: true, cardType: true } }
          }
        }
      },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    });

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const items = page.flatMap((review) => {
      const snapshot = review.lot.playerSnapshot as { card?: unknown };
      const parsedSnapshot = AuctionPlayerCardSnapshotSchema.safeParse(snapshot.card);
      const fallbackCard = review.lot.playerCard;
      const card = parsedSnapshot.success ? parsedSnapshot.data : fallbackCard;
      if (
        !card || !review.reviewedWinnerTeamId || review.reviewedPrice === null ||
        !review.winnerTeamNameSnapshot || !review.winnerDisplayNameSnapshot || !review.lot.playerCardId
      ) return [];
      return [{
        id: review.id,
        batchId: review.lot.batch.id,
        league: review.lot.batch.league,
        player: {
          id: review.lot.footballPlayerId,
          cardId: review.lot.playerCardId,
          name: review.lot.playerNameSnapshot,
          imageUrl: card.imageUrl,
          position: card.position,
          overallRating: card.overallRating,
          cardType: card.cardType
        },
        winner: {
          teamId: review.reviewedWinnerTeamId,
          teamNumber: review.winnerTeamNumberSnapshot,
          teamName: review.winnerTeamNameSnapshot,
          bidderDisplayName: review.winnerDisplayNameSnapshot
        },
        price: review.reviewedPrice,
        confirmedAt: review.reviewedAt.toISOString()
      }];
    });
    return { items, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
  }

  async placeBid(
    userId: string,
    batchId: string,
    input: PlaceMiniprogramAuctionBidRequest,
    idempotencyKey: string
  ) {
    return this.bids.placeMiniprogramBid(userId, batchId, input, idempotencyKey);
  }

  private lotView(lot: {
    id: string;
    displayOrder: number;
    playerNameSnapshot: string;
    playerSnapshot: unknown;
    startingPrice: number;
    minimumIncrement: number;
    status: string;
    currentPrice: number | null;
    deadlineAt: Date | null;
    deadlineEpoch: number;
    currentHighestBid: {
      leagueTeam: { teamNumber: number | null; name: string } | null;
      user: { displayName: string } | null;
    } | null;
    review: {
      decision: string;
      winnerTeamNumberSnapshot: number | null;
      winnerTeamNameSnapshot: string | null;
      winnerDisplayNameSnapshot: string | null;
      reviewedPrice: number | null;
    } | null;
    bids: Array<{
      id: string;
      amount: number;
      result: string;
      submittedAt: Date;
      leagueTeam: { teamNumber: number | null; name: string } | null;
      user: { displayName: string } | null;
    }>;
  }, includeBids: boolean) {
    const closed = ['PENDING_REVIEW', 'REVIEWED'].includes(lot.status);
    const reviewed = lot.status === 'REVIEWED' ? lot.review : null;
    const winningTeam = reviewed
      ? reviewed.winnerTeamNameSnapshot && reviewed.winnerDisplayNameSnapshot && reviewed.reviewedPrice
        ? { teamNumber: reviewed.winnerTeamNumberSnapshot, teamName: reviewed.winnerTeamNameSnapshot, bidderDisplayName: reviewed.winnerDisplayNameSnapshot, price: reviewed.reviewedPrice }
        : null
      : lot.currentHighestBid?.leagueTeam && lot.currentHighestBid.user && lot.currentPrice
        ? { teamNumber: lot.currentHighestBid.leagueTeam.teamNumber, teamName: lot.currentHighestBid.leagueTeam.name, bidderDisplayName: lot.currentHighestBid.user.displayName, price: lot.currentPrice }
        : null;
    return {
      id: lot.id,
      displayOrder: lot.displayOrder,
      playerName: lot.playerNameSnapshot,
      playerSnapshot: lot.playerSnapshot,
      card: AuctionPlayerCardSnapshotSchema.parse((lot.playerSnapshot as { card?: unknown }).card),
      startingPrice: lot.startingPrice,
      minimumIncrement: lot.minimumIncrement,
      status: lot.status,
      currentPrice: lot.currentPrice,
      winner: closed ? winningTeam : null,
      deadlineAt: lot.deadlineAt?.toISOString() ?? null,
      deadlineEpoch: lot.deadlineEpoch,
      ...(includeBids ? {
        bids: lot.bids
          .filter((bid) => bid.result === 'VALID')
          .sort((left, right) => right.submittedAt.getTime() - left.submittedAt.getTime() || right.id.localeCompare(left.id))
          .map((bid) => ({
            id: bid.id,
            teamNumber: bid.leagueTeam?.teamNumber ?? null,
            teamName: bid.leagueTeam?.name ?? '未知球队',
            bidderDisplayName: bid.user?.displayName ?? '未知用户',
            amount: bid.amount,
            submittedAt: bid.submittedAt.toISOString()
          }))
      } : {})
    };
  }

  private sharePath(batchId: string) {
    return `/pages/auction-room/index?batchId=${batchId}`;
  }
}
