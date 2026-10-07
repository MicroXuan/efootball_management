import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  type CreateImportBatchRequest,
  ImportBatchSchema,
  ImportRecordSchema,
  type ImportBatchResponse,
  type ImportDiffType,
  type ImportRecordResponse,
  type NormalizedPlayerCardRecord,
  type PlayerImportRecordPage,
  type PlatformPageRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ImportFormat, PlayerCardStatus } from '../generated/prisma/enums.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { CsvImportAdapter } from './csv-import.adapter.js';
import { calculateRecordDiff, type CalculatedDiff } from './import-diff.js';
import { JsonImportAdapter } from './json-import.adapter.js';
import { normalizeImportRow, normalizeSearchText } from './record-normalizer.js';
import type { ParsedImportRow, RawImportRow } from './import-adapter.js';

type ValidationError = { code: string; path: string; message: string };
export type PlatformImportRecordQuery = Pick<PlatformPageRequest, 'page' | 'pageSize' | 'query'> & {
  diffType?: ImportDiffType;
};

export class ImportDomainError extends BadRequestException {
  readonly code: string;

  constructor(code: string, message: string) {
    super({ code, message });
    this.code = code;
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function checksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function dateOnly(value: Date | null | undefined): string | undefined {
  return value?.toISOString().slice(0, 10);
}

function toExistingRecord(card: {
  externalId: string;
  cardName: string;
  position: NormalizedPlayerCardRecord['position'];
  overallRating: number;
  cardType: NormalizedPlayerCardRecord['cardType'];
  playStyle: string | null;
  status: PlayerCardStatus;
  imageUrl: string | null;
  sourceUpdatedAt: Date | null;
  player: {
    nameZh: string | null;
    nameEn: string | null;
    shortName: string | null;
    nationality: string | null;
    club: string | null;
    sources: Array<{ externalId: string }>;
  };
  cardPack: {
    externalId: string;
    nameZh: string | null;
    nameEn: string | null;
    season: string | null;
    releaseDate: Date | null;
  } | null;
  attributes: { attributesJson: unknown } | null;
  skills: Array<{ skill: { code: string } }>;
}): NormalizedPlayerCardRecord {
  return {
    externalId: card.externalId,
    playerExternalId: card.player.sources[0]?.externalId,
    playerNameZh: card.player.nameZh ?? undefined,
    playerNameEn: card.player.nameEn ?? undefined,
    playerShortName: card.player.shortName ?? undefined,
    nationality: card.player.nationality ?? undefined,
    club: card.player.club ?? undefined,
    cardName: card.cardName,
    position: card.position,
    overallRating: card.overallRating,
    cardType: card.cardType,
    playStyle: card.playStyle ?? undefined,
    status: card.status,
    imageUrl: card.imageUrl ?? undefined,
    packExternalId: card.cardPack?.externalId,
    packName: card.cardPack?.nameZh ?? card.cardPack?.nameEn ?? undefined,
    season: card.cardPack?.season ?? undefined,
    releaseDate: dateOnly(card.cardPack?.releaseDate),
    sourceUpdatedAt: card.sourceUpdatedAt?.toISOString(),
    skills: card.skills.map(({ skill }) => skill.code),
    attributes: (card.attributes?.attributesJson ?? {}) as NormalizedPlayerCardRecord['attributes']
  };
}

@Injectable()
export class PlayerImportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Optional() @Inject(AdminAuthorizationService) private readonly adminAuthorization?: AdminAuthorizationService
  ) {}

  async createBatch(actorId: string, input: CreateImportBatchRequest): Promise<ImportBatchResponse> {
    return (await this.createBatchWithOutcome(actorId, input)).batch;
  }

  async assertCanCreateBatch(actorId: string): Promise<void> {
    await this.requirePermission(actorId, 'catalog.import.create');
  }

  async createBatchWithOutcome(
    actorId: string,
    input: CreateImportBatchRequest
  ): Promise<{ batch: ImportBatchResponse; created: boolean }> {
    await this.assertCanCreateBatch(actorId);
    return this.createBatchUnchecked(actorId, input);
  }

  async createBatchForPlatformAdmin(
    actorAdminId: string,
    input: CreateImportBatchRequest
  ): Promise<{ batch: ImportBatchResponse; created: boolean }> {
    await this.requirePlatformAdmin(actorAdminId);
    return this.createBatchUnchecked(actorAdminId, input);
  }

  private async createBatchUnchecked(
    actorId: string,
    input: CreateImportBatchRequest
  ): Promise<{ batch: ImportBatchResponse; created: boolean }> {

    const source = await this.prisma.dataSource.findUnique({ where: { code: input.sourceCode } });
    if (!source?.isEnabled) {
      throw new ImportDomainError('IMPORT_SOURCE_UNAVAILABLE', 'Import source is missing or disabled');
    }

    const contentChecksum = checksum(input.content);
    const duplicate = await this.prisma.importBatch.findUnique({
      where: { sourceId_checksum: { sourceId: source.id, checksum: contentChecksum } },
      include: { source: true, release: true }
    });
    if (duplicate) return { batch: this.batchResponse(duplicate), created: false };

    const batch = await this.prisma.importBatch.create({
      data: {
        sourceId: source.id,
        fileName: input.fileName,
        format: input.format as ImportFormat,
        checksum: contentChecksum,
        createdBy: actorId
      }
    });

    if (input.content.length === 0) {
      await this.failBatch(batch.id, 'EMPTY_IMPORT_CONTENT');
      throw new ImportDomainError('EMPTY_IMPORT_CONTENT', 'Import content must not be empty');
    }

    let rows: ParsedImportRow[];
    try {
      rows = this.adapterFor(input.format).parse(input.content);
    } catch {
      await this.failBatch(batch.id, 'IMPORT_PARSE_FAILED');
      throw new ImportDomainError('IMPORT_PARSE_FAILED', 'Import content could not be parsed');
    }

    if (rows.length > 5000) {
      await this.failBatch(batch.id, 'IMPORT_ROW_LIMIT_EXCEEDED');
      throw new ImportDomainError('IMPORT_ROW_LIMIT_EXCEEDED', 'Import files may contain at most 5,000 rows');
    }

    const prepared = rows.map((row) => this.prepareRow(row));
    const duplicateIds = new Set(
      [...prepared.reduce((counts, item) => {
        const externalId = item.normalized?.externalId;
        if (externalId) counts.set(externalId, (counts.get(externalId) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())]
        .filter(([, count]) => count > 1)
        .map(([externalId]) => externalId)
    );

    const records: Array<Awaited<ReturnType<PlayerImportService['reviewRecord']>>> = [];
    for (const item of prepared) {
      if (item.normalized && duplicateIds.has(item.normalized.externalId)) {
        item.errors.push({
          code: 'DUPLICATE_EXTERNAL_ID',
          path: 'externalId',
          message: 'External ID occurs more than once in this batch'
        });
      }
      records.push(await this.reviewRecord(source.id, item));
    }

    const counts = records.reduce(
      (result, record) => ({ ...result, [record.diffType]: result[record.diffType] + 1 }),
      { CREATE: 0, UPDATE: 0, UNCHANGED: 0, INVALID: 0 } as Record<ImportDiffType, number>
    );
    const status = counts.INVALID === 0 ? 'READY' : 'VALIDATED';

    await this.prisma.$transaction(async (tx) => {
      for (const record of records) {
        await tx.importRecord.create({
          data: {
            batchId: batch.id,
            rowNumber: record.rowNumber,
            externalId: record.normalized?.externalId ?? null,
            contentChecksum: record.normalized ? checksum(JSON.stringify(record.normalized)) : null,
            rawJson: jsonValue(record.raw),
            normalizedJson: record.normalized ? jsonValue(record.normalized) : Prisma.JsonNull,
            diffType: record.diffType,
            fieldDiff: jsonValue(record.fields),
            validationErrors: jsonValue(record.errors),
            targetPlayerId: record.targetPlayerId,
            targetCardId: record.targetCardId
          }
        });
      }
      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status,
          totalCount: records.length,
          createCount: counts.CREATE,
          updateCount: counts.UPDATE,
          unchangedCount: counts.UNCHANGED,
          invalidCount: counts.INVALID
        }
      });
    });

    return { batch: await this.getBatchUnchecked(batch.id), created: true };
  }

  async getBatch(actorId: string, batchId: string) {
    await this.requirePermission(actorId, 'catalog.import.read');
    return this.getBatchUnchecked(batchId);
  }

  async getBatchForPlatformAdmin(actorAdminId: string, batchId: string): Promise<ImportBatchResponse> {
    await this.requirePlatformAdmin(actorAdminId);
    return this.getBatchUnchecked(batchId);
  }

  async listRecords(
    actorId: string,
    batchId: string,
    filter: { diffType?: ImportDiffType | undefined }
  ) {
    await this.requirePermission(actorId, 'catalog.import.read');
    await this.ensureBatch(batchId);
    const records = await this.prisma.importRecord.findMany({
      where: { batchId, ...(filter.diffType ? { diffType: filter.diffType } : {}) },
      orderBy: { rowNumber: 'asc' }
    });
    return records.map((record) => this.recordResponse(record));
  }

  async listRecordsForPlatformAdmin(
    actorAdminId: string,
    batchId: string,
    query: PlatformImportRecordQuery
  ): Promise<PlayerImportRecordPage> {
    await this.requirePlatformAdmin(actorAdminId);
    const batch = await this.ensureBatch(batchId);
    const where: Prisma.ImportRecordWhereInput = {
      batchId,
      ...(query.diffType ? { diffType: query.diffType } : {})
    };
    let records;
    let total: number;
    if (query.query) {
      const pattern = `%${query.query}%`;
      const conditions: Prisma.Sql[] = [Prisma.sql`batch_id = ${batchId}`];
      if (query.diffType) conditions.push(Prisma.sql`diff_type = ${query.diffType}`);
      conditions.push(Prisma.sql`(
        external_id LIKE ${pattern}
        OR JSON_UNQUOTE(JSON_EXTRACT(normalized_json, '$.playerNameZh')) LIKE ${pattern}
        OR JSON_UNQUOTE(JSON_EXTRACT(normalized_json, '$.playerNameEn')) LIKE ${pattern}
        OR JSON_UNQUOTE(JSON_EXTRACT(normalized_json, '$.playerShortName')) LIKE ${pattern}
        OR JSON_UNQUOTE(JSON_EXTRACT(normalized_json, '$.cardName')) LIKE ${pattern}
        OR JSON_UNQUOTE(JSON_EXTRACT(normalized_json, '$.packName')) LIKE ${pattern}
      )`);
      const whereSql = Prisma.join(conditions, ' AND ');
      const offset = (query.page - 1) * query.pageSize;
      const [ids, counts] = await this.prisma.$transaction([
        this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM import_records
          WHERE ${whereSql}
          ORDER BY \`row_number\` ASC, id ASC
          LIMIT ${query.pageSize} OFFSET ${offset}
        `),
        this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
          SELECT COUNT(*) AS total FROM import_records WHERE ${whereSql}
        `)
      ]);
      const rows = ids.length ? await this.prisma.importRecord.findMany({
        where: { id: { in: ids.map(({ id }) => id) } }
      }) : [];
      const positions = new Map(ids.map(({ id }, index) => [id, index]));
      records = rows.sort((left, right) => (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0));
      total = Number(counts[0]?.total ?? 0);
    } else {
      [records, total] = await this.prisma.$transaction([
        this.prisma.importRecord.findMany({
          where,
          orderBy: { rowNumber: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize
        }),
        this.prisma.importRecord.count({ where })
      ]);
    }
    return {
      items: records.map((record) => this.recordResponse(record)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      summary: {
        create: batch.createCount,
        update: batch.updateCount,
        unchanged: batch.unchangedCount,
        invalid: batch.invalidCount
      }
    };
  }

  async cancelBatch(actorId: string, batchId: string) {
    await this.requirePermission(actorId, 'catalog.import.publish');
    return this.cancelBatchUnchecked(batchId);
  }

  async cancelBatchForPlatformAdmin(actorAdminId: string, batchId: string): Promise<ImportBatchResponse> {
    await this.requirePlatformAdmin(actorAdminId);
    return this.cancelBatchUnchecked(batchId);
  }

  private async cancelBatchUnchecked(batchId: string): Promise<ImportBatchResponse> {
    const batch = await this.ensureBatch(batchId);
    if (batch.status === 'CANCELLED') return this.getBatchUnchecked(batchId);
    if (!['UPLOADED', 'VALIDATED', 'READY'].includes(batch.status)) {
      throw new ImportDomainError('IMPORT_BATCH_NOT_CANCELLABLE', 'Import batch cannot be cancelled');
    }
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'CANCELLED' } });
    return this.getBatchUnchecked(batchId);
  }

  private adapterFor(format: CreateImportBatchRequest['format']) {
    if (format === 'CSV') return new CsvImportAdapter();
    if (format === 'JSON') return new JsonImportAdapter();
    throw new ImportDomainError('UNSUPPORTED_IMPORT_FORMAT', 'Import format is not supported');
  }

  private prepareRow(row: ParsedImportRow): {
    rowNumber: number;
    raw: RawImportRow;
    normalized: NormalizedPlayerCardRecord | null;
    errors: ValidationError[];
  } {
    try {
      return { ...row, raw: row.value, normalized: normalizeImportRow(row.value), errors: [] };
    } catch (error) {
      return {
        rowNumber: row.rowNumber,
        raw: row.value,
        normalized: null,
        errors: [{ code: 'INVALID_RECORD', path: '', message: error instanceof Error ? error.message : 'Invalid record' }]
      };
    }
  }

  private async reviewRecord(
    sourceId: string,
    item: ReturnType<PlayerImportService['prepareRow']>
  ) {
    const invalid = (): CalculatedDiff => ({ type: 'INVALID', fields: {}, errors: item.errors });
    if (!item.normalized || item.errors.length > 0) {
      return { ...item, ...invalid(), diffType: 'INVALID' as const, targetPlayerId: null, targetCardId: null };
    }

    const existingCard = await this.prisma.playerCard.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: item.normalized.externalId } },
      include: {
        player: { include: { sources: { where: { sourceId } } } },
        cardPack: true,
        attributes: true,
        skills: { include: { skill: true } }
      }
    });

    let targetPlayerId: string | null = existingCard?.playerId ?? null;
    if (!targetPlayerId && item.normalized.playerExternalId) {
      const identity = await this.prisma.footballPlayerSource.findUnique({
        where: {
          sourceId_externalId: { sourceId, externalId: item.normalized.playerExternalId }
        }
      });
      targetPlayerId = identity?.playerId ?? null;
    }

    if (!targetPlayerId && !item.normalized.playerExternalId) {
      const normalizedNameZh = item.normalized.playerNameZh
        ? normalizeSearchText(item.normalized.playerNameZh)
        : undefined;
      const normalizedNameEn = item.normalized.playerNameEn
        ? normalizeSearchText(item.normalized.playerNameEn)
        : undefined;
      const candidates = await this.prisma.footballPlayer.findMany({
        where: {
          OR: [
            ...(normalizedNameZh ? [{ normalizedNameZh }] : []),
            ...(normalizedNameEn ? [{ normalizedNameEn }] : [])
          ]
        },
        select: { id: true }
      });
      if (candidates.length > 1) {
        const errors = [{
          code: 'AMBIGUOUS_PLAYER_MATCH',
          path: 'playerNameEn',
          message: 'More than one player matches the normalized name'
        }];
        return { ...item, errors, fields: {}, diffType: 'INVALID' as const, targetPlayerId: null, targetCardId: existingCard?.id ?? null };
      }
      targetPlayerId = candidates[0]?.id ?? null;
    }

    const diff = calculateRecordDiff(existingCard ? toExistingRecord(existingCard) : null, item.normalized);
    return {
      ...item,
      errors: diff.errors,
      fields: diff.fields,
      diffType: diff.type,
      targetPlayerId,
      targetCardId: existingCard?.id ?? null
    };
  }

  private async requirePermission(actorId: string, permission: string): Promise<void> {
    if (!(await this.authorization.can(actorId, permission))) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Permission denied' });
    }
  }

  private async requirePlatformAdmin(actorAdminId: string): Promise<void> {
    if (!this.adminAuthorization) {
      throw new ForbiddenException({ code: 'ADMIN_PLATFORM_ACCESS_DENIED', message: 'Platform administrator access is required' });
    }
    await this.adminAuthorization.requirePlatformAdmin(actorAdminId);
  }

  private recordResponse(record: {
    id: string;
    batchId: string;
    rowNumber: number;
    externalId: string | null;
    diffType: ImportDiffType;
    rawJson: Prisma.JsonValue;
    normalizedJson: Prisma.JsonValue | null;
    fieldDiff: Prisma.JsonValue;
    validationErrors: Prisma.JsonValue;
    targetPlayerId: string | null;
    targetCardId: string | null;
  }): ImportRecordResponse {
    return ImportRecordSchema.parse({
      id: record.id,
      batchId: record.batchId,
      rowNumber: record.rowNumber,
      externalId: record.externalId,
      diffType: record.diffType,
      raw: record.rawJson,
      normalized: record.normalizedJson,
      fieldDiff: record.fieldDiff,
      validationErrors: record.validationErrors,
      targetPlayerId: record.targetPlayerId,
      targetCardId: record.targetCardId
    });
  }

  private async failBatch(batchId: string, reason: string): Promise<void> {
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'FAILED', failureReason: reason }
    });
  }

  private async ensureBatch(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException({ code: 'IMPORT_BATCH_NOT_FOUND' });
    return batch;
  }

  private async getBatchUnchecked(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { source: true, release: true }
    });
    if (!batch) throw new NotFoundException({ code: 'IMPORT_BATCH_NOT_FOUND' });
    return this.batchResponse(batch);
  }

  private batchResponse(batch: {
    id: string;
    source: { code: string };
    fileName: string;
    format: ImportFormat;
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
