import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CardPackDetail,
  CardPackListResponse,
  PlayerCardDetail,
  PlayerCardSummary,
  PlayerDetail,
  PlayerSearchQuery,
  PlayerSearchResponse
} from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import type { PlayerCardVersion } from '../generated/prisma/client.js';
import { decodeCatalogCursor, encodeCatalogCursor, type CatalogCursor } from './catalog-cursor.js';
import { normalizeSearchText } from '../player-import/record-normalizer.js';

type PackListQuery = { cursor?: string | undefined; limit: number };

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function compareSnapshot(
  left: Pick<PlayerCardVersion, 'publishedAt' | 'overallRating' | 'playerCardId'>,
  right: { publishedAt: Date; overallRating: number; playerCardId: string }
): number {
  return right.publishedAt.getTime() - left.publishedAt.getTime()
    || right.overallRating - left.overallRating
    || left.playerCardId.localeCompare(right.playerCardId);
}

function comparePack(
  left: { id: string; newest: Pick<PlayerCardVersion, 'publishedAt' | 'overallRating'> },
  right: { id: string; newest: Pick<PlayerCardVersion, 'publishedAt' | 'overallRating'> }
): number {
  return right.newest.publishedAt.getTime() - left.newest.publishedAt.getTime()
    || right.newest.overallRating - left.newest.overallRating
    || left.id.localeCompare(right.id);
}

@Injectable()
export class PlayerCatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(query: PlayerSearchQuery): Promise<PlayerSearchResponse> {
    const cursor = query.cursor ? decodeCatalogCursor(query.cursor) : null;
    const releaseSequence = cursor?.releaseSequence ?? await this.latestReleaseSequence();
    const keyword = query.keyword ? normalizeSearchText(query.keyword) : null;
    const snapshots = (await this.latestVersions(releaseSequence))
      .filter((version) => version.status === 'ACTIVE')
      .filter((version) => !keyword || [
        version.normalizedNameZh,
        version.normalizedNameEn,
        version.cardName,
        version.packNameZh,
        version.packNameEn
      ].some((value) => value && normalizeSearchText(value).includes(keyword)))
      .filter((version) => !query.position || version.position === query.position)
      .filter((version) => query.minOverall === undefined || version.overallRating >= query.minOverall)
      .filter((version) => query.maxOverall === undefined || version.overallRating <= query.maxOverall)
      .filter((version) => !query.cardType || version.cardType === query.cardType)
      .filter((version) => !query.cardPackId || version.cardPackId === query.cardPackId)
      .sort(compareSnapshot);

    const afterCursor = cursor ? snapshots.filter((version) => this.isAfter(version, cursor)) : snapshots;
    const page = afterCursor.slice(0, query.limit + 1);
    const hasMore = page.length > query.limit;
    const visible = page.slice(0, query.limit);
    const last = visible.at(-1);

    return {
      items: visible.map((version) => this.summary(version)),
      nextCursor: hasMore && last ? encodeCatalogCursor({
        releaseSequence,
        publishedAt: last.publishedAt.toISOString(),
        overallRating: last.overallRating,
        id: last.playerCardId
      }) : null,
      releaseSequence
    };
  }

  async getPlayer(id: string): Promise<PlayerDetail> {
    const releaseSequence = await this.latestReleaseSequence();
    const cards = (await this.latestVersions(releaseSequence))
      .filter((version) => version.playerId === id && version.status === 'ACTIVE')
      .sort(compareSnapshot);
    const first = cards[0];
    if (!first) throw new NotFoundException({ code: 'PLAYER_NOT_FOUND' });
    return {
      id,
      nameZh: first.playerNameZh,
      nameEn: first.playerNameEn,
      shortName: first.playerShortName,
      nationality: first.nationality,
      club: first.club,
      cards: cards.map((card) => this.summary(card))
    };
  }

  async getCard(id: string): Promise<PlayerCardDetail> {
    const releaseSequence = await this.latestReleaseSequence();
    const all = await this.latestVersions(releaseSequence);
    const card = all.find((version) => version.playerCardId === id && version.status === 'ACTIVE');
    if (!card) throw new NotFoundException({ code: 'PLAYER_CARD_NOT_FOUND' });
    const skills = Array.isArray(card.skillsJson) ? card.skillsJson : [];
    return {
      ...this.summary(card),
      nationality: card.nationality,
      club: card.club,
      status: card.status,
      skills: skills.filter((skill): skill is string => typeof skill === 'string').map((code) => ({
        code,
        nameZh: null,
        nameEn: code
      })),
      attributes: card.attributesJson as Record<string, number>,
      otherCards: all
        .filter((version) =>
          version.playerId === card.playerId
          && version.playerCardId !== card.playerCardId
          && version.status === 'ACTIVE'
        )
        .sort(compareSnapshot)
        .map((version) => this.summary(version))
    };
  }

  async listPacks(query: PackListQuery): Promise<CardPackListResponse> {
    const cursor = query.cursor ? decodeCatalogCursor(query.cursor) : null;
    const releaseSequence = cursor?.releaseSequence ?? await this.latestReleaseSequence();
    const versions = (await this.latestVersions(releaseSequence)).filter(
      (version) => version.status === 'ACTIVE' && version.cardPackId
    );
    const grouped = new Map<string, PlayerCardVersion[]>();
    for (const version of versions) {
      const packId = version.cardPackId!;
      grouped.set(packId, [...(grouped.get(packId) ?? []), version]);
    }
    const packs = [...grouped.entries()].map(([id, cards]) => {
      const newest = [...cards].sort(compareSnapshot)[0]!;
      return { id, newest, cards };
    }).sort(comparePack);
    const filtered = cursor
      ? packs.filter(({ id, newest }) => comparePack(
          { id, newest },
          {
            id: cursor.id,
            newest: {
              publishedAt: new Date(cursor.publishedAt),
              overallRating: cursor.overallRating
            }
          }
        ) > 0)
      : packs;
    const page = filtered.slice(0, query.limit + 1);
    const hasMore = page.length > query.limit;
    const visible = page.slice(0, query.limit);
    const last = visible.at(-1);
    return {
      items: visible.map(({ id, newest, cards }) => ({
        id,
        nameZh: newest.packNameZh,
        nameEn: newest.packNameEn,
        season: newest.packSeason,
        releaseDate: dateOnly(newest.packReleaseDate),
        coverUrl: newest.packCoverUrl,
        cardCount: cards.length
      })),
      nextCursor: hasMore && last ? encodeCatalogCursor({
        releaseSequence,
        publishedAt: last.newest.publishedAt.toISOString(),
        overallRating: last.newest.overallRating,
        id: last.id
      }) : null,
      releaseSequence
    };
  }

  async getPack(id: string): Promise<CardPackDetail> {
    const releaseSequence = await this.latestReleaseSequence();
    const cards = (await this.latestVersions(releaseSequence))
      .filter((version) => version.cardPackId === id && version.status === 'ACTIVE')
      .sort(compareSnapshot);
    const first = cards[0];
    if (!first) throw new NotFoundException({ code: 'CARD_PACK_NOT_FOUND' });
    return {
      id,
      nameZh: first.packNameZh,
      nameEn: first.packNameEn,
      season: first.packSeason,
      releaseDate: dateOnly(first.packReleaseDate),
      coverUrl: first.packCoverUrl,
      cards: cards.map((card) => this.summary(card))
    };
  }

  private async latestReleaseSequence(): Promise<number> {
    const release = await this.prisma.catalogRelease.findFirst({ orderBy: { sequence: 'desc' } });
    if (!release) throw new NotFoundException({ code: 'CATALOG_EMPTY' });
    return release.sequence;
  }

  private async latestVersions(releaseSequence: number): Promise<PlayerCardVersion[]> {
    const versions = await this.prisma.playerCardVersion.findMany({
      where: { releaseSequence: { lte: releaseSequence } },
      orderBy: { releaseSequence: 'desc' }
    });
    const latest = new Map<string, PlayerCardVersion>();
    for (const version of versions) {
      if (!latest.has(version.playerCardId)) latest.set(version.playerCardId, version);
    }
    return [...latest.values()];
  }

  private isAfter(version: PlayerCardVersion, cursor: CatalogCursor): boolean {
    return compareSnapshot(version, {
      publishedAt: new Date(cursor.publishedAt),
      overallRating: cursor.overallRating,
      playerCardId: cursor.id
    }) > 0;
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
