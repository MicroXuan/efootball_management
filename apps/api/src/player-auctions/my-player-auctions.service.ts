import { Inject, Injectable } from '@nestjs/common';
import type { MyPlayerAuctionListQuery, PlaceMiniprogramAuctionBidRequest } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerAuctionError } from './player-auction.errors.js';
import { PlayerAuctionBidService } from './player-auction-bid.service.js';

const ACTIVE_STATUSES = ['READY', 'ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED'] as const;
const ROOM_INCLUDE = {
  league: { select: { id: true, name: true } },
  lots: {
    include: {
      bids: {
        where: { result: 'VALID' as const },
        include: { leagueTeam: { select: { name: true } } },
        orderBy: [{ submittedAt: 'asc' as const }, { id: 'asc' as const }]
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
    if (!team) throw new PlayerAuctionError('NO_ACTIVE_TEAM', '没有当前联赛的有效球队', 403);
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
      team: { id: team.id, name: team.name },
      canBid: batch.status === 'ACTIVE' && current?.status === 'ACTIVE',
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
    bids: Array<{ id: string; amount: number; result: string; submittedAt: Date; leagueTeam: { name: string } | null }>;
  }, includeBids: boolean) {
    return {
      id: lot.id,
      displayOrder: lot.displayOrder,
      playerName: lot.playerNameSnapshot,
      playerSnapshot: lot.playerSnapshot,
      startingPrice: lot.startingPrice,
      minimumIncrement: lot.minimumIncrement,
      status: lot.status,
      currentPrice: lot.currentPrice,
      deadlineAt: lot.deadlineAt?.toISOString() ?? null,
      deadlineEpoch: lot.deadlineEpoch,
      ...(includeBids ? {
        bids: lot.bids.filter((bid) => bid.result === 'VALID').map((bid) => ({
          id: bid.id,
          teamName: bid.leagueTeam?.name ?? '未知球队',
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
