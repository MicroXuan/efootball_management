import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  ImportBatchSchema,
  NormalizedPlayerCardRecordSchema,
  type ImportBatchResponse
} from '@efm/contracts';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import {
  buildPlayerImportPublicationPlan,
  publicationSnapshotKey
} from './player-import-publication-plan.js';
import {
  loadPlayerImportPublicationState,
  writePlayerImportPublicationPlan
} from './player-import-publication.repository.js';
import type { PreparedPublicationRecord } from './player-import-publication.types.js';

type Transaction = Prisma.TransactionClient;

export const PLAYER_IMPORT_PUBLICATION_TIMEOUT_MS = 60_000;

export type PreparedPlayerImportPublication = {
  batchId: string;
  preparedRecords: readonly PreparedPublicationRecord[];
  snapshotKey: string;
};

export type ImportBatchWithSourceAndRelease = Prisma.ImportBatchGetPayload<{
  include: { source: true; release: true };
}>;

export type ExecutePlayerImportPublicationInput = {
  actorId: string;
  batchId: string;
  platformAdmin: boolean;
  preparedRecords: readonly PreparedPublicationRecord[];
  snapshotKey: string;
  audit?: AuditLogService | undefined;
};

class ImportBatchNotReadyError extends ConflictException {
  readonly code = 'IMPORT_BATCH_NOT_READY';

  constructor(message: string) {
    super({ code: 'IMPORT_BATCH_NOT_READY', message });
  }
}

function prepareRecords(records: readonly {
  id: string;
  diffType: string;
  normalizedJson: Prisma.JsonValue | null;
  fieldDiff: Prisma.JsonValue;
  targetPlayerId: string | null;
}[]): PreparedPublicationRecord[] {
  const prepared: PreparedPublicationRecord[] = [];
  for (const record of records) {
    if (record.diffType === 'UNCHANGED') continue;
    if (record.diffType !== 'CREATE' && record.diffType !== 'UPDATE') {
      throw new ImportBatchNotReadyError('Batch contains an invalid record');
    }
    prepared.push({
      id: record.id,
      diffType: record.diffType,
      changedFields: new Set(Object.keys(record.fieldDiff as Record<string, unknown>)),
      targetPlayerId: record.targetPlayerId,
      value: NormalizedPlayerCardRecordSchema.parse(record.normalizedJson)
    });
  }
  return prepared;
}

export async function preparePlayerImportPublication(
  prisma: PrismaService,
  batchId: string
): Promise<PreparedPlayerImportPublication> {
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { records: { orderBy: { rowNumber: 'asc' } } }
  });
  if (!batch) throw new NotFoundException({ code: 'IMPORT_BATCH_NOT_FOUND' });
  if (batch.status !== 'READY' && batch.status !== 'PUBLISHED') {
    throw new ImportBatchNotReadyError('Only ready batches can be published');
  }
  const preparedRecords = prepareRecords(batch.records);
  return { batchId, preparedRecords, snapshotKey: publicationSnapshotKey(preparedRecords) };
}

export async function executePlayerImportPublication(
  tx: Transaction,
  input: ExecutePlayerImportPublicationInput
): Promise<ImportBatchWithSourceAndRelease> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM import_batches WHERE id = ${input.batchId} FOR UPDATE`);
  const batch = await tx.importBatch.findUnique({
    where: { id: input.batchId },
    include: { source: true, release: true, records: { orderBy: { rowNumber: 'asc' } } }
  });
  if (!batch) throw new NotFoundException({ code: 'IMPORT_BATCH_NOT_FOUND' });
  if (batch.status === 'PUBLISHED' && batch.release) return batch;
  if (batch.status !== 'READY' || batch.invalidCount > 0) {
    throw new ImportBatchNotReadyError('Only ready batches can be published');
  }

  const currentRecords = prepareRecords(batch.records);
  if (publicationSnapshotKey(currentRecords) !== input.snapshotKey) {
    throw new ImportBatchNotReadyError('Batch changed before publication');
  }

  const release = await tx.catalogRelease.create({
    data: {
      batchId: input.batchId,
      publishedBy: input.actorId,
      createdCount: batch.createCount,
      updatedCount: batch.updateCount,
      unchangedCount: batch.unchangedCount
    }
  });
  const state = await loadPlayerImportPublicationState(tx, {
    sourceId: batch.sourceId,
    records: input.preparedRecords
  });
  const plan = buildPlayerImportPublicationPlan({
    sourceId: batch.sourceId,
    records: input.preparedRecords,
    state,
    releaseSequence: release.sequence,
    publishedAt: release.publishedAt
  });
  await writePlayerImportPublicationPlan(tx, plan);

  const published = await tx.importBatch.update({
    where: { id: input.batchId },
    data: { status: 'PUBLISHED', publishedAt: release.publishedAt },
    include: { source: true, release: true }
  });
  if (input.platformAdmin && input.audit) {
    await input.audit.record(tx, {
      actorAdminId: input.actorId,
      action: 'PUBLISH_PLAYER_CARD_IMPORT_BATCH',
      resourceType: 'ImportBatch',
      resourceId: input.batchId,
      metadata: {
        batchId: input.batchId,
        status: published.status,
        createCount: published.createCount,
        updateCount: published.updateCount
      }
    });
  }
  return published;
}

@Injectable()
export class PlayerImportPublisher {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Optional() @Inject(AdminAuthorizationService) private readonly adminAuthorization?: AdminAuthorizationService,
    @Optional() @Inject(AuditLogService) private readonly audit?: AuditLogService
  ) {}

  async publish(actorId: string, batchId: string): Promise<ImportBatchResponse> {
    if (!(await this.authorization.can(actorId, 'catalog.import.publish'))) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Permission denied' });
    }
    return this.publishUnchecked(actorId, batchId, false);
  }

  async publishForPlatformAdmin(actorAdminId: string, batchId: string): Promise<ImportBatchResponse> {
    if (!this.adminAuthorization) {
      throw new ForbiddenException({
        code: 'ADMIN_PLATFORM_ACCESS_DENIED',
        message: 'Platform administrator access is required'
      });
    }
    await this.adminAuthorization.requirePlatformAdmin(actorAdminId);
    return this.publishUnchecked(actorAdminId, batchId, true);
  }

  private async publishUnchecked(
    actorId: string,
    batchId: string,
    platformAdmin: boolean
  ): Promise<ImportBatchResponse> {
    try {
      const prepared = await preparePlayerImportPublication(this.prisma, batchId);
      const published = await this.prisma.$transaction(
        (tx) => executePlayerImportPublication(tx, {
          actorId,
          batchId,
          platformAdmin,
          preparedRecords: prepared.preparedRecords,
          snapshotKey: prepared.snapshotKey,
          audit: this.audit
        }),
        { timeout: PLAYER_IMPORT_PUBLICATION_TIMEOUT_MS }
      );
      return this.toResponse(published);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
        throw new ServiceUnavailableException({
          code: 'IMPORT_PUBLISH_TIMEOUT',
          message: '批次发布超时，数据已回滚，可安全重试'
        });
      }
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

  private toResponse(batch: ImportBatchWithSourceAndRelease): ImportBatchResponse {
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
