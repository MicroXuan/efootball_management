import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  derivePesdataAutoBuild,
  type CardPackDetail,
  type CardPackListResponse,
  type PlayerCardDetail,
  type PlayerCardSummary,
  type PlayerDetail,
  type PlayerSearchQuery,
  type PlayerSearchResponse
} from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import type { PlayerCardVersion } from '../generated/prisma/client.js';
import { decodeCatalogCursor, encodeCatalogCursor } from './catalog-cursor.js';
import { normalizeSearchText } from '../player-import/record-normalizer.js';
import { PlayerCatalogReadRepository } from './player-catalog-read.repository.js';
import { decodePlayerSearchCursor, encodePlayerSearchCursor, isPlayerSearchCursor } from './player-search-cursor.js';

type PackListQuery = { cursor?: string | undefined; limit: number };

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(
    (entry): entry is [string, number] => Number.isInteger(entry[1]) && Number(entry[1]) >= 0
  ));
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

@Injectable()
export class PlayerCatalogService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerCatalogReadRepository) private readonly read: PlayerCatalogReadRepository
  ) {}

  async search(query: PlayerSearchQuery): Promise<PlayerSearchResponse> {
    const cursor = query.cursor ? decodePlayerSearchCursor(query.cursor) : null;
    const releaseSequence = cursor?.releaseSequence ?? await this.latestReleaseSequence();
    const keyword = query.keyword ? normalizeSearchText(query.keyword) : null;
    const page = await this.read.search({ ...query, releaseSequence, keyword, after: cursor });
    const hasMore = page.length > query.limit;
    const visible = page.slice(0, query.limit);
    const last = visible.at(-1);

    return {
      items: visible.map((version) => this.summary(version)),
      nextCursor: hasMore && last ? (
        cursor && !isPlayerSearchCursor(cursor)
          ? encodeCatalogCursor({
              releaseSequence,
              publishedAt: last.publishedAt.toISOString(),
              overallRating: last.overallRating,
              id: last.playerCardId
            })
          : encodePlayerSearchCursor({
              version: 2,
              releaseSequence,
              packReleaseDate: dateOnly(last.packReleaseDate),
              publishedAt: last.publishedAt.toISOString(),
              overallRating: last.overallRating,
              id: last.playerCardId
            })
      ) : null,
      releaseSequence
    };
  }

  async getPlayer(id: string): Promise<PlayerDetail> {
    const releaseSequence = await this.latestReleaseSequence();
    const cards = await this.read.listPlayerCardsAtRelease(id, releaseSequence);
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
    const card = await this.read.findCardAtRelease(id, releaseSequence);
    if (!card) throw new NotFoundException({ code: 'PLAYER_CARD_NOT_FOUND' });
    const otherCards = await this.read.listPlayerCardsAtRelease(card.playerId, releaseSequence);
    const skills = Array.isArray(card.skillsJson) ? card.skillsJson : [];
    const autoBuild = await this.prisma.playerCardAutoBuild.findFirst({
      where: { playerCardId: id },
      orderBy: [{ calculatedAt: 'desc' }, { createdAt: 'desc' }]
    });
    const attributes = objectRecord(card.attributesJson);
    const sourceMetadata = objectRecord(attributes?.sourceMetadata);
    const derivedAutoBuild = autoBuild ? null : derivePesdataAutoBuild({
      position: card.position,
      overallRating: card.overallRating,
      maxLevel: sourceMetadata?.maxLevel as number | string | null | undefined,
      cardType: card.cardType
    });
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
      autoBuild: autoBuild
        ? {
            allocation: numericRecord(autoBuild.allocationJson),
            maxOverall: autoBuild.maxOverall,
            dtRating: autoBuild.dtRating,
            algorithmVersion: autoBuild.algorithmVersion
          }
        : derivedAutoBuild,
      otherCards: otherCards
        .filter((version) =>
          version.playerId === card.playerId
          && version.playerCardId !== card.playerCardId
          && version.status === 'ACTIVE'
        )
        .map((version) => this.summary(version))
    };
  }

  async listPacks(query: PackListQuery): Promise<CardPackListResponse> {
    const cursor = query.cursor ? decodeCatalogCursor(query.cursor) : null;
    const releaseSequence = cursor?.releaseSequence ?? await this.latestReleaseSequence();
    const page = await this.read.listPacksAtRelease({ releaseSequence, after: cursor, limit: query.limit });
    const hasMore = page.length > query.limit;
    const visible = page.slice(0, query.limit);
    const last = visible.at(-1);
    return {
      items: visible.map(({ id, newest, count }) => ({
        id,
        nameZh: newest.packNameZh,
        nameEn: newest.packNameEn,
        season: newest.packSeason,
        releaseDate: dateOnly(newest.packReleaseDate),
        coverUrl: newest.packCoverUrl,
        cardCount: count
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
    const cards = await this.read.listPackCardsAtRelease(id, releaseSequence);
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
