import { Inject, Injectable } from '@nestjs/common';
import type { PlayerSearchQuery } from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { PlayerCardVersion } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { isPlayerSearchCursor, type AnyPlayerSearchCursor } from './player-search-cursor.js';

function escapeLike(value: string): string {
  return value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
}

@Injectable()
export class PlayerCatalogReadRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(input: Omit<PlayerSearchQuery, 'keyword' | 'cursor'> & {
    releaseSequence: number;
    keyword: string | null;
    after: AnyPlayerSearchCursor | null;
  }): Promise<PlayerCardVersion[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`v.status = 'ACTIVE'`];
    if (input.keyword) {
      const pattern = `%${escapeLike(input.keyword)}%`;
      conditions.push(Prisma.sql`(
        v.normalized_name_zh COLLATE utf8mb4_bin LIKE ${pattern} ESCAPE '!'
        OR v.normalized_name_en COLLATE utf8mb4_bin LIKE ${pattern} ESCAPE '!'
        OR v.normalized_card_name COLLATE utf8mb4_bin LIKE ${pattern} ESCAPE '!'
        OR v.normalized_pack_name_zh COLLATE utf8mb4_bin LIKE ${pattern} ESCAPE '!'
        OR v.normalized_pack_name_en COLLATE utf8mb4_bin LIKE ${pattern} ESCAPE '!'
      )`);
    }
    if (input.position) conditions.push(Prisma.sql`v.position = ${input.position}`);
    if (input.minOverall !== undefined) conditions.push(Prisma.sql`v.overall_rating >= ${input.minOverall}`);
    if (input.maxOverall !== undefined) conditions.push(Prisma.sql`v.overall_rating <= ${input.maxOverall}`);
    if (input.cardType) conditions.push(Prisma.sql`v.card_type = ${input.cardType}`);
    if (input.cardPackId) conditions.push(Prisma.sql`v.card_pack_id = ${input.cardPackId}`);

    const cursor = input.after;
    const legacy = cursor !== null && !isPlayerSearchCursor(cursor);
    if (cursor) {
      const publishedAt = new Date(cursor.publishedAt);
      const tail = Prisma.sql`(
        v.overall_rating < ${cursor.overallRating}
        OR (v.overall_rating = ${cursor.overallRating} AND (
          v.published_at < ${publishedAt}
          OR (v.published_at = ${publishedAt} AND v.player_card_id > ${cursor.id})
        ))
      )`;
      if (legacy) {
        conditions.push(Prisma.sql`(
          v.published_at < ${publishedAt}
          OR (v.published_at = ${publishedAt} AND (
            v.overall_rating < ${cursor.overallRating}
            OR (v.overall_rating = ${cursor.overallRating} AND v.player_card_id > ${cursor.id})
          ))
        )`);
      } else {
        const date = cursor.packReleaseDate ? new Date(`${cursor.packReleaseDate}T00:00:00.000Z`) : null;
        conditions.push(date
          ? Prisma.sql`(v.pack_release_date < ${date} OR v.pack_release_date IS NULL OR (v.pack_release_date = ${date} AND ${tail}))`
          : Prisma.sql`(v.pack_release_date IS NULL AND ${tail})`);
      }
    }

    const order = legacy
      ? Prisma.sql`v.published_at DESC, v.overall_rating DESC, v.player_card_id ASC`
      : Prisma.sql`v.pack_release_date DESC, v.overall_rating DESC, v.published_at DESC, v.player_card_id ASC`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT v.id
      FROM player_card_versions v
      WHERE v.release_sequence <= ${input.releaseSequence}
        AND NOT EXISTS (
          SELECT 1 FROM player_card_versions newer
          WHERE newer.player_card_id = v.player_card_id
            AND newer.release_sequence <= ${input.releaseSequence}
            AND newer.release_sequence > v.release_sequence
        )
        AND ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${order}
      LIMIT ${input.limit + 1}
    `);
    if (!rows.length) return [];
    const versions = await this.prisma.playerCardVersion.findMany({ where: { id: { in: rows.map(({ id }) => id) } } });
    const byId = new Map(versions.map((version) => [version.id, version]));
    return rows.flatMap(({ id }) => {
      const version = byId.get(id);
      return version ? [version] : [];
    });
  }

  async findCardAtRelease(cardId: string, releaseSequence: number): Promise<PlayerCardVersion | null> {
    return this.prisma.playerCardVersion.findFirst({
      where: { playerCardId: cardId, releaseSequence: { lte: releaseSequence } },
      orderBy: { releaseSequence: 'desc' }
    });
  }

  async listPlayerCardsAtRelease(playerId: string, releaseSequence: number): Promise<PlayerCardVersion[]> {
    return this.listLatestFor(Prisma.sql`v.player_id = ${playerId}`, releaseSequence);
  }

  async listPackCardsAtRelease(packId: string, releaseSequence: number): Promise<PlayerCardVersion[]> {
    return this.listLatestFor(Prisma.sql`v.card_pack_id = ${packId}`, releaseSequence);
  }

  private async listLatestFor(target: Prisma.Sql, releaseSequence: number): Promise<PlayerCardVersion[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT v.id FROM player_card_versions v
      WHERE ${target} AND v.release_sequence <= ${releaseSequence} AND v.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM player_card_versions newer
          WHERE newer.player_card_id = v.player_card_id
            AND newer.release_sequence <= ${releaseSequence}
            AND newer.release_sequence > v.release_sequence
        )
      ORDER BY v.published_at DESC, v.overall_rating DESC, v.player_card_id ASC
    `);
    if (!rows.length) return [];
    const versions = await this.prisma.playerCardVersion.findMany({ where: { id: { in: rows.map(({ id }) => id) } } });
    const byId = new Map(versions.map((version) => [version.id, version]));
    return rows.flatMap(({ id }) => {
      const version = byId.get(id);
      return version ? [version] : [];
    });
  }

  async listPacksAtRelease(input: {
    releaseSequence: number;
    after: { id: string; publishedAt: string; overallRating: number } | null;
    limit: number;
  }): Promise<Array<{ id: string; newest: PlayerCardVersion; count: number }>> {
    const after = input.after;
    const cursorCondition = after ? Prisma.sql`AND (
      ranked.published_at < ${new Date(after.publishedAt)}
      OR (ranked.published_at = ${new Date(after.publishedAt)} AND (
        ranked.overall_rating < ${after.overallRating}
        OR (ranked.overall_rating = ${after.overallRating} AND ranked.card_pack_id > ${after.id})
      ))
    )` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; versionId: string; cardCount: bigint }>>(Prisma.sql`
      SELECT ranked.card_pack_id AS id, ranked.id AS versionId, ranked.card_count AS cardCount
      FROM (
        SELECT v.id, v.card_pack_id, v.published_at, v.overall_rating,
          ROW_NUMBER() OVER (PARTITION BY v.card_pack_id ORDER BY v.published_at DESC, v.overall_rating DESC, v.player_card_id ASC) AS rank_no,
          COUNT(*) OVER (PARTITION BY v.card_pack_id) AS card_count
        FROM player_card_versions v
        WHERE v.release_sequence <= ${input.releaseSequence}
          AND v.status = 'ACTIVE' AND v.card_pack_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM player_card_versions newer
            WHERE newer.player_card_id = v.player_card_id
              AND newer.release_sequence <= ${input.releaseSequence}
              AND newer.release_sequence > v.release_sequence
          )
      ) ranked
      WHERE ranked.rank_no = 1 ${cursorCondition}
      ORDER BY ranked.published_at DESC, ranked.overall_rating DESC, ranked.card_pack_id ASC
      LIMIT ${input.limit + 1}
    `);
    if (!rows.length) return [];
    const versions = await this.prisma.playerCardVersion.findMany({ where: { id: { in: rows.map(({ versionId }) => versionId) } } });
    const byId = new Map(versions.map((version) => [version.id, version]));
    return rows.flatMap((row) => {
      const newest = byId.get(row.versionId);
      return newest ? [{ id: row.id, newest, count: Number(row.cardCount) }] : [];
    });
  }

  async listPackOptionsAtRelease(releaseSequence: number): Promise<Array<{
    id: string;
    nameZh: string | null;
    nameEn: string | null;
  }>> {
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT p.id, p.name_zh AS nameZh, p.name_en AS nameEn
      FROM card_packs p
      WHERE EXISTS (
        SELECT 1 FROM player_card_versions v
        WHERE v.card_pack_id = p.id
          AND v.release_sequence <= ${releaseSequence}
          AND v.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM player_card_versions newer
            WHERE newer.player_card_id = v.player_card_id
              AND newer.release_sequence <= ${releaseSequence}
              AND newer.release_sequence > v.release_sequence
          )
      )
      ORDER BY p.release_date DESC, p.id ASC
    `);
  }
}
