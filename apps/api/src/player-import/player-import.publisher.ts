import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ImportBatchSchema,
  NormalizedPlayerCardRecordSchema,
  type ImportBatchResponse,
  type NormalizedPlayerCardRecord
} from '@efm/contracts';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PlayerCardStatus } from '../generated/prisma/enums.js';
import { ImportDomainError } from './player-import.service.js';
import { normalizeSearchText } from './record-normalizer.js';

type Transaction = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

@Injectable()
export class PlayerImportPublisher {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService
  ) {}

  async publish(actorId: string, batchId: string): Promise<ImportBatchResponse> {
    if (!(await this.authorization.can(actorId, 'catalog.import.publish'))) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Permission denied' });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM import_batches WHERE id = ${batchId} FOR UPDATE`);
        const batch = await tx.importBatch.findUnique({
          where: { id: batchId },
          include: { source: true, release: true, records: { orderBy: { rowNumber: 'asc' } } }
        });
        if (!batch) throw new NotFoundException({ code: 'IMPORT_BATCH_NOT_FOUND' });
        if (batch.status === 'PUBLISHED' && batch.release) return this.toResponse(batch);

        const invalidCount = await tx.importRecord.count({
          where: { batchId, diffType: 'INVALID' }
        });
        if (batch.status !== 'READY' || invalidCount > 0) {
          throw new ImportDomainError('IMPORT_BATCH_NOT_READY', 'Only ready batches can be published');
        }

        const release = await tx.catalogRelease.create({
          data: {
            batchId,
            publishedBy: actorId,
            createdCount: batch.createCount,
            updatedCount: batch.updateCount,
            unchangedCount: batch.unchangedCount
          }
        });

        for (const record of batch.records) {
          if (record.diffType === 'UNCHANGED') continue;
          if (record.diffType !== 'CREATE' && record.diffType !== 'UPDATE') {
            throw new ImportDomainError('IMPORT_BATCH_NOT_READY', 'Batch contains an invalid record');
          }
          const normalized = NormalizedPlayerCardRecordSchema.parse(record.normalizedJson);
          const changedFields = new Set(Object.keys(record.fieldDiff as Record<string, unknown>));
          await this.publishRecord(
            tx,
            batch.sourceId,
            normalized,
            record.diffType,
            changedFields,
            release.sequence,
            release.publishedAt,
            record.targetPlayerId
          );
        }

        const published = await tx.importBatch.update({
          where: { id: batchId },
          data: { status: 'PUBLISHED', publishedAt: release.publishedAt },
          include: { source: true, release: true }
        });
        return this.toResponse(published);
      }, { timeout: 30_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const published = await this.prisma.importBatch.findUnique({
          where: { id: batchId },
          include: { source: true, release: true }
        });
        if (published?.status === 'PUBLISHED' && published.release) return this.toResponse(published);
      }
      throw error;
    }
  }

  private async publishRecord(
    tx: Transaction,
    sourceId: string,
    value: NormalizedPlayerCardRecord,
    diffType: 'CREATE' | 'UPDATE',
    changed: Set<string>,
    releaseSequence: number,
    publishedAt: Date,
    matchedPlayerId: string | null
  ): Promise<void> {
    const writeAll = diffType === 'CREATE';
    let playerId = matchedPlayerId;
    if (!playerId && value.playerExternalId) {
      const identity = await tx.footballPlayerSource.findUnique({
        where: { sourceId_externalId: { sourceId, externalId: value.playerExternalId } }
      });
      playerId = identity?.playerId ?? null;
    }
    if (!playerId) {
      const player = await tx.footballPlayer.create({
        data: this.playerCreateData(value, publishedAt, releaseSequence)
      });
      playerId = player.id;
    } else {
      const data = this.playerUpdateData(value, changed, writeAll);
      await tx.footballPlayer.update({
        where: { id: playerId },
        data: { ...data, publishedAt, lastPublishedReleaseSequence: releaseSequence }
      });
    }

    if (value.playerExternalId) {
      await tx.footballPlayerSource.upsert({
        where: { sourceId_externalId: { sourceId, externalId: value.playerExternalId } },
        create: {
          sourceId,
          externalId: value.playerExternalId,
          playerId,
          sourceUpdatedAt: asDate(value.sourceUpdatedAt)
        },
        update: { playerId, sourceUpdatedAt: asDate(value.sourceUpdatedAt) }
      });
    }

    let cardPackId: string | null | undefined;
    if (value.packExternalId) {
      const pack = await tx.cardPack.upsert({
        where: { sourceId_externalId: { sourceId, externalId: value.packExternalId } },
        create: {
          sourceId,
          externalId: value.packExternalId,
          nameZh: value.packName ?? null,
          season: value.season ?? null,
          releaseDate: asDate(value.releaseDate),
          publishedAt,
          lastPublishedReleaseSequence: releaseSequence
        },
        update: {
          ...(writeAll || changed.has('packName') ? { nameZh: value.packName ?? null } : {}),
          ...(writeAll || changed.has('season') ? { season: value.season ?? null } : {}),
          ...(writeAll || changed.has('releaseDate') ? { releaseDate: asDate(value.releaseDate) } : {}),
          publishedAt,
          lastPublishedReleaseSequence: releaseSequence
        }
      });
      cardPackId = pack.id;
    } else if (writeAll || changed.has('packExternalId')) {
      cardPackId = null;
    }

    const card = await tx.playerCard.upsert({
      where: { sourceId_externalId: { sourceId, externalId: value.externalId } },
      create: {
        sourceId,
        externalId: value.externalId,
        playerId,
        cardPackId: cardPackId ?? null,
        cardName: value.cardName,
        position: value.position,
        overallRating: value.overallRating,
        cardType: value.cardType,
        playStyle: value.playStyle ?? null,
        status: value.status as PlayerCardStatus,
        imageUrl: value.imageUrl ?? null,
        sourceUpdatedAt: asDate(value.sourceUpdatedAt),
        publishedAt,
        lastPublishedReleaseSequence: releaseSequence
      },
      update: {
        playerId,
        ...(cardPackId !== undefined ? { cardPackId } : {}),
        ...(changed.has('cardName') ? { cardName: value.cardName } : {}),
        ...(changed.has('position') ? { position: value.position } : {}),
        ...(changed.has('overallRating') ? { overallRating: value.overallRating } : {}),
        ...(changed.has('cardType') ? { cardType: value.cardType } : {}),
        ...(changed.has('playStyle') ? { playStyle: value.playStyle ?? null } : {}),
        ...(changed.has('status') ? { status: value.status as PlayerCardStatus } : {}),
        ...(changed.has('imageUrl') ? { imageUrl: value.imageUrl ?? null } : {}),
        ...(changed.has('sourceUpdatedAt') ? { sourceUpdatedAt: asDate(value.sourceUpdatedAt) } : {}),
        publishedAt,
        lastPublishedReleaseSequence: releaseSequence
      }
    });

    if (writeAll || changed.has('attributes')) {
      await tx.playerCardAttribute.upsert({
        where: { playerCardId: card.id },
        create: { playerCardId: card.id, attributesJson: asJson(value.attributes) },
        update: { attributesJson: asJson(value.attributes) }
      });
    }

    if (writeAll || changed.has('skills')) {
      await tx.playerCardSkill.deleteMany({ where: { playerCardId: card.id } });
      for (const skillName of value.skills) {
        const code = normalizeSearchText(skillName);
        const skill = await tx.skill.upsert({
          where: { code },
          create: { code, nameEn: skillName },
          update: { nameEn: skillName }
        });
        await tx.playerCardSkill.create({ data: { playerCardId: card.id, skillId: skill.id } });
      }
    }

    await this.createVersion(tx, card.id, releaseSequence, publishedAt);
  }

  private playerCreateData(
    value: NormalizedPlayerCardRecord,
    publishedAt: Date,
    releaseSequence: number
  ) {
    return {
      nameZh: value.playerNameZh ?? null,
      nameEn: value.playerNameEn ?? null,
      normalizedNameZh: value.playerNameZh ? normalizeSearchText(value.playerNameZh) : null,
      normalizedNameEn: value.playerNameEn ? normalizeSearchText(value.playerNameEn) : null,
      shortName: value.playerShortName ?? null,
      nationality: value.nationality ?? null,
      club: value.club ?? null,
      publishedAt,
      lastPublishedReleaseSequence: releaseSequence
    };
  }

  private playerUpdateData(
    value: NormalizedPlayerCardRecord,
    changed: Set<string>,
    writeAll: boolean
  ) {
    return {
      ...(writeAll || changed.has('playerNameZh') ? {
        nameZh: value.playerNameZh ?? null,
        normalizedNameZh: value.playerNameZh ? normalizeSearchText(value.playerNameZh) : null
      } : {}),
      ...(writeAll || changed.has('playerNameEn') ? {
        nameEn: value.playerNameEn ?? null,
        normalizedNameEn: value.playerNameEn ? normalizeSearchText(value.playerNameEn) : null
      } : {}),
      ...(writeAll || changed.has('playerShortName') ? { shortName: value.playerShortName ?? null } : {}),
      ...(writeAll || changed.has('nationality') ? { nationality: value.nationality ?? null } : {}),
      ...(writeAll || changed.has('club') ? { club: value.club ?? null } : {})
    };
  }

  private async createVersion(
    tx: Transaction,
    playerCardId: string,
    releaseSequence: number,
    publishedAt: Date
  ): Promise<void> {
    const card = await tx.playerCard.findUniqueOrThrow({
      where: { id: playerCardId },
      include: { player: true, cardPack: true, attributes: true, skills: { include: { skill: true } } }
    });
    await tx.playerCardVersion.create({
      data: {
        playerCardId: card.id,
        releaseSequence,
        playerId: card.playerId,
        playerNameZh: card.player.nameZh,
        playerNameEn: card.player.nameEn,
        normalizedNameZh: card.player.normalizedNameZh,
        normalizedNameEn: card.player.normalizedNameEn,
        playerShortName: card.player.shortName,
        nationality: card.player.nationality,
        club: card.player.club,
        cardPackId: card.cardPackId,
        packNameZh: card.cardPack?.nameZh ?? null,
        packNameEn: card.cardPack?.nameEn ?? null,
        packSeason: card.cardPack?.season ?? null,
        packReleaseDate: card.cardPack?.releaseDate ?? null,
        packCoverUrl: card.cardPack?.coverUrl ?? null,
        cardName: card.cardName,
        position: card.position,
        overallRating: card.overallRating,
        cardType: card.cardType,
        playStyle: card.playStyle,
        status: card.status,
        imageUrl: card.imageUrl,
        sourceUpdatedAt: card.sourceUpdatedAt,
        skillsJson: asJson(card.skills.map(({ skill }) => skill.code)),
        attributesJson: asJson(card.attributes?.attributesJson ?? {}),
        publishedAt
      }
    });
  }

  private toResponse(batch: {
    id: string;
    source: { code: string };
    fileName: string;
    format: string;
    checksum: string;
    status: string;
    totalCount: number;
    createCount: number;
    updateCount: number;
    unchangedCount: number;
    invalidCount: number;
    failureReason: string | null;
    createdBy: string;
    createdAt: Date;
    publishedAt: Date | null;
    release: { id: string; sequence: number } | null;
  }): ImportBatchResponse {
    return ImportBatchSchema.parse({
      id: batch.id,
      sourceCode: batch.source.code,
      fileName: batch.fileName,
      format: batch.format,
      checksum: batch.checksum,
      status: batch.status,
      totalCount: batch.totalCount,
      createCount: batch.createCount,
      updateCount: batch.updateCount,
      unchangedCount: batch.unchangedCount,
      invalidCount: batch.invalidCount,
      failureReason: batch.failureReason,
      releaseId: batch.release?.id ?? null,
      releaseSequence: batch.release?.sequence ?? null,
      createdBy: batch.createdBy,
      createdAt: batch.createdAt.toISOString(),
      publishedAt: batch.publishedAt?.toISOString() ?? null
    });
  }
}
