import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  PlayerCardSummary,
  PlayerFavoriteListQuery,
  PlayerFavoriteListResponse,
  PlayerFavoriteStatusResponse
} from '@efm/contracts';
import type { PlayerCardVersion, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

type FavoriteCursor = { createdAt: string; id: string };

function encodeCursor(cursor: FavoriteCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): FavoriteCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<FavoriteCursor>;
    if (!parsed.createdAt || !parsed.id || Number.isNaN(new Date(parsed.createdAt).getTime())) throw new Error();
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new NotFoundException({ code: 'FAVORITE_CURSOR_INVALID', message: '收藏列表游标无效' });
  }
}

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function compareCards(left: PlayerCardVersion, right: PlayerCardVersion): number {
  return right.overallRating - left.overallRating
    || right.publishedAt.getTime() - left.publishedAt.getTime()
    || left.playerCardId.localeCompare(right.playerCardId);
}

@Injectable()
export class PlayerFavoritesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async favorite(userId: string, playerId: string): Promise<PlayerFavoriteStatusResponse> {
    const player = await this.prisma.footballPlayer.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!player) throw new NotFoundException({ code: 'PLAYER_NOT_FOUND', message: '球员不存在' });
    await this.prisma.userPlayerFavorite.upsert({
      where: { userId_footballPlayerId: { userId, footballPlayerId: playerId } },
      create: { userId, footballPlayerId: playerId },
      update: {}
    });
    return { favoritePlayerIds: [playerId] };
  }

  async unfavorite(userId: string, playerId: string): Promise<PlayerFavoriteStatusResponse> {
    await this.prisma.userPlayerFavorite.deleteMany({ where: { userId, footballPlayerId: playerId } });
    return { favoritePlayerIds: [] };
  }

  async statuses(userId: string, playerIds: string[]): Promise<PlayerFavoriteStatusResponse> {
    const uniqueIds = [...new Set(playerIds)];
    const rows = await this.prisma.userPlayerFavorite.findMany({
      where: { userId, footballPlayerId: { in: uniqueIds } },
      select: { footballPlayerId: true },
      orderBy: { createdAt: 'desc' }
    });
    const favoriteIds = new Set(rows.map((row) => row.footballPlayerId));
    return { favoritePlayerIds: uniqueIds.filter((id) => favoriteIds.has(id)) };
  }

  async list(userId: string, query: PlayerFavoriteListQuery): Promise<PlayerFavoriteListResponse> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const keyword = query.keyword?.trim();
    const playerFilter: Prisma.FootballPlayerWhereInput = {
      cards: { some: { status: 'ACTIVE', publishedAt: { not: null } } },
      ...(keyword ? {
        OR: [
          { nameZh: { contains: keyword } },
          { nameEn: { contains: keyword } },
          { shortName: { contains: keyword } },
          { cards: { some: { status: 'ACTIVE', cardName: { contains: keyword } } } }
        ]
      } : {})
    };
    const rows = await this.prisma.userPlayerFavorite.findMany({
      where: {
        userId,
        footballPlayer: playerFilter,
        ...(cursor ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }
          ]
        } : {})
      },
      include: {
        footballPlayer: {
          select: {
            nameZh: true,
            nameEn: true,
            shortName: true,
            bestCard: { select: { playerCardId: true } }
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1
    });
    if (rows.length === 0) return { items: [], nextCursor: null };

    const release = await this.prisma.catalogRelease.findFirst({ orderBy: { sequence: 'desc' }, select: { sequence: true } });
    if (!release) return { items: [], nextCursor: null };
    const versions = await this.prisma.playerCardVersion.findMany({
      where: {
        releaseSequence: { lte: release.sequence },
        playerId: { in: rows.map((row) => row.footballPlayerId) }
      },
      orderBy: { releaseSequence: 'desc' }
    });
    const latestByCard = new Map<string, PlayerCardVersion>();
    for (const version of versions) {
      if (!latestByCard.has(version.playerCardId)) latestByCard.set(version.playerCardId, version);
    }
    const activeByPlayer = new Map<string, PlayerCardVersion[]>();
    for (const version of latestByCard.values()) {
      if (version.status !== 'ACTIVE') continue;
      activeByPlayer.set(version.playerId, [...(activeByPlayer.get(version.playerId) ?? []), version]);
    }
    for (const cards of activeByPlayer.values()) cards.sort(compareCards);

    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.flatMap((row) => {
      const cards = activeByPlayer.get(row.footballPlayerId) ?? [];
      const preferred = row.footballPlayer.bestCard?.playerCardId;
      const card = cards.find((candidate) => candidate.playerCardId === preferred) ?? cards[0];
      return card ? [{
        playerId: row.footballPlayerId,
        favoritedAt: row.createdAt.toISOString(),
        card: this.summary(card)
      }] : [];
    });
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor: rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null
    };
  }

  private summary(version: PlayerCardVersion): PlayerCardSummary {
    return {
      id: version.playerCardId,
      playerId: version.playerId,
      playerNameZh: version.playerNameZh,
      playerNameEn: version.playerNameEn,
      cardName: version.cardName,
      position: version.position,
      overallRating: version.overallRating,
      cardType: version.cardType,
      playStyle: version.playStyle,
      imageUrl: version.imageUrl,
      pack: version.cardPackId ? {
        id: version.cardPackId,
        nameZh: version.packNameZh,
        nameEn: version.packNameEn,
        season: version.packSeason,
        releaseDate: dateOnly(version.packReleaseDate),
        coverUrl: version.packCoverUrl
      } : null,
      publishedAt: version.publishedAt.toISOString()
    };
  }
}
