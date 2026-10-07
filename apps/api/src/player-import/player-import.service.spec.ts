import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { calculateRecordDiff } from './import-diff.js';
import { ImportDomainError, PlayerImportService } from './player-import.service.js';

config({ path: '../../.env', quiet: true });

const validCard = {
  externalId: 'card-1',
  playerNameEn: 'Alexis Mac Allister',
  cardName: 'Featured',
  position: 'CMF' as const,
  overallRating: 95,
  cardType: 'FEATURED' as const,
  status: 'ACTIVE' as const,
  skills: ['Passing'],
  attributes: { passing: 96 }
};

describe('calculateRecordDiff', () => {
  it('returns CREATE when no existing card is present', () => {
    expect(calculateRecordDiff(null, validCard)).toEqual({ type: 'CREATE', fields: {}, errors: [] });
  });

  it('treats reordered skills and attribute keys as unchanged', () => {
    const existing = {
      ...validCard,
      skills: ['Vision', 'Passing'],
      attributes: { speed: 80, passing: 96 }
    };
    const incoming = {
      ...existing,
      skills: ['Passing', 'Vision'],
      attributes: { passing: 96, speed: 80 }
    };

    expect(calculateRecordDiff(existing, incoming).type).toBe('UNCHANGED');
  });

  it('returns an exact source-owned field map for updates', () => {
    expect(calculateRecordDiff(validCard, { ...validCard, overallRating: 96 })).toEqual({
      type: 'UPDATE',
      fields: { overallRating: { before: 95, after: 96 } },
      errors: []
    });
  });
});

describe('PlayerImportService', () => {
  const prisma = new PrismaService();
  let canResult = true;
  const authorizationCalls: Array<[string, string]> = [];
  const authorization = {
    can: async (userId: string, permission: string) => {
      authorizationCalls.push([userId, permission]);
      const result = canResult;
      canResult = true;
      return result;
    }
  };
  const platformAuthorizationCalls: string[] = [];
  const adminAuthorization = {
    requirePlatformAdmin: async (adminId: string) => {
      platformAuthorizationCalls.push(adminId);
      return { id: adminId };
    }
  };
  const service = new PlayerImportService(prisma, authorization as never, adminAuthorization as never);
  const actorId = randomUUID();
  const adminId = randomUUID();
  let sourceCode: string;
  let sourceId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: { id: actorId, wechatOpenId: `import-test-${actorId}`, displayName: '导入测试员' }
    });
  });

  beforeEach(async () => {
    authorizationCalls.length = 0;
    platformAuthorizationCalls.length = 0;
    sourceCode = `test-${randomUUID()}`;
    const source = await prisma.dataSource.create({
      data: { code: sourceCode, name: 'Test source' }
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    await prisma.importBatch.deleteMany({ where: { sourceId } });
    await prisma.playerCard.deleteMany({ where: { sourceId } });
    await prisma.footballPlayerSource.deleteMany({ where: { sourceId } });
    await prisma.cardPack.deleteMany({ where: { sourceId } });
    await prisma.dataSource.deleteMany({ where: { id: sourceId } });
    await prisma.footballPlayer.deleteMany({
      where: { nameEn: { startsWith: 'Ambiguous Import Test' } }
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  const createJsonBatch = (rows: unknown[]) =>
    service.createBatch(actorId, {
      sourceCode,
      fileName: 'players.json',
      format: 'JSON',
      content: JSON.stringify(rows)
    });

  it('creates a platform batch without checking ordinary user permissions', async () => {
    const outcome = await service.createBatchForPlatformAdmin(adminId, {
      sourceCode,
      fileName: 'platform-players.json',
      format: 'JSON',
      content: JSON.stringify([{ ...validCard, externalId: 'platform-card' }])
    });

    expect(outcome.batch.status).toBe('READY');
    expect(platformAuthorizationCalls).toEqual([adminId]);
    expect(authorizationCalls).toEqual([]);
  });

  it('keeps ordinary import creation on user scope authorization', async () => {
    const batch = await createJsonBatch([{ ...validCard, externalId: 'user-card' }]);

    expect(batch.status).toBe('READY');
    expect(authorizationCalls).toContainEqual([actorId, 'catalog.import.create']);
    expect(platformAuthorizationCalls).toEqual([]);
  });

  it('reads, paginates, and cancels a batch through the platform boundary', async () => {
    const outcome = await service.createBatchForPlatformAdmin(adminId, {
      sourceCode,
      fileName: 'platform-review.json',
      format: 'JSON',
      content: JSON.stringify(Array.from({ length: 25 }, (_, index) => ({
        ...validCard,
        externalId: `platform-review-${index + 1}`
      })))
    });
    platformAuthorizationCalls.length = 0;

    const batch = await service.getBatchForPlatformAdmin(adminId, outcome.batch.id);
    const records = await service.listRecordsForPlatformAdmin(adminId, outcome.batch.id, {
      page: 2,
      pageSize: 20
    });
    const cancelled = await service.cancelBatchForPlatformAdmin(adminId, outcome.batch.id);

    expect(batch.totalCount).toBe(25);
    expect(records).toMatchObject({ page: 2, pageSize: 20, total: 25 });
    expect(records.items).toHaveLength(5);
    expect(cancelled.status).toBe('CANCELLED');
    expect(platformAuthorizationCalls).toEqual([adminId, adminId, adminId]);
    expect(authorizationCalls).toEqual([]);
  });

  it('persists a ready CREATE batch and returns it for the same checksum', async () => {
    const first = await createJsonBatch([validCard]);
    const duplicate = await createJsonBatch([validCard]);

    expect(first.status).toBe('READY');
    expect(first.createCount).toBe(1);
    expect(duplicate.id).toBe(first.id);
    await expect(prisma.importBatch.count({ where: { sourceId } })).resolves.toBe(1);
  });

  it('marks every duplicate external ID invalid', async () => {
    const batch = await createJsonBatch([validCard, { ...validCard, overallRating: 96 }]);
    const records = await service.listRecords(actorId, batch.id, { diffType: 'INVALID' });

    expect(batch.status).toBe('VALIDATED');
    expect(batch.invalidCount).toBe(2);
    expect(records).toHaveLength(2);
    expect(records[0]?.validationErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_EXTERNAL_ID' })])
    );
  });

  it('persists malformed attributes as an invalid record without aborting the batch', async () => {
    const batch = await service.createBatch(actorId, {
      sourceCode,
      fileName: 'players.csv',
      format: 'CSV',
      content:
        'externalId,playerNameEn,cardName,position,overallRating,cardType,attributesJson\n' +
        'bad-1,Alexis,Featured,CMF,95,FEATURED,"{not-json}"\n'
    });
    const [record] = await service.listRecords(actorId, batch.id, {});

    expect(batch.status).toBe('VALIDATED');
    expect(record?.diffType).toBe('INVALID');
    expect(record?.validationErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'INVALID_RECORD' })])
    );
  });

  it('marks a name-only match invalid when multiple players match', async () => {
    await prisma.footballPlayer.createMany({
      data: [
        {
          nameEn: 'Ambiguous Import Test A',
          normalizedNameEn: 'ambiguous import test'
        },
        {
          nameEn: 'Ambiguous Import Test B',
          normalizedNameEn: 'ambiguous import test'
        }
      ]
    });
    const batch = await createJsonBatch([
      { ...validCard, externalId: 'ambiguous-1', playerNameEn: 'Ambiguous Import Test' }
    ]);
    const [record] = await service.listRecords(actorId, batch.id, {});

    expect(batch.status).toBe('VALIDATED');
    expect(record?.validationErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'AMBIGUOUS_PLAYER_MATCH' })])
    );
  });

  it('fails an empty file and a file containing 5,001 rows with stable codes', async () => {
    await expect(
      service.createBatch(actorId, {
        sourceCode,
        fileName: 'empty.json',
        format: 'JSON',
        content: ''
      })
    ).rejects.toMatchObject({ code: 'EMPTY_IMPORT_CONTENT' });

    await expect(createJsonBatch(Array.from({ length: 5001 }, (_, index) => ({
      ...validCard,
      externalId: `large-${index}`
    })))).rejects.toMatchObject({ code: 'IMPORT_ROW_LIMIT_EXCEEDED' });

    const failed = await prisma.importBatch.findMany({ where: { sourceId, status: 'FAILED' } });
    expect(failed).toHaveLength(2);
  });

  it('rejects an inactive source without creating a batch', async () => {
    await prisma.dataSource.update({ where: { id: sourceId }, data: { isEnabled: false } });

    await expect(createJsonBatch([validCard])).rejects.toBeInstanceOf(ImportDomainError);
    await expect(createJsonBatch([validCard])).rejects.toMatchObject({ code: 'IMPORT_SOURCE_UNAVAILABLE' });
    await expect(prisma.importBatch.count({ where: { sourceId } })).resolves.toBe(0);
  });

  it('checks create authorization before looking up a source', async () => {
    canResult = false;

    await expect(createJsonBatch([validCard])).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorizationCalls).toContainEqual([actorId, 'catalog.import.create']);
  });

  it('exposes an authorization preflight for long-running import producers', async () => {
    canResult = false;

    await expect(service.assertCanCreateBatch(actorId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorizationCalls).toContainEqual([actorId, 'catalog.import.create']);
  });
});

describe('PlayerImportService cancellation locking', () => {
  it('locks the batch row and cancels it in the same transaction', async () => {
    const batchId = randomUUID();
    const calls: string[] = [];
    const batch = {
      id: batchId,
      source: { code: 'pesdata' },
      fileName: 'players.json',
      format: 'JSON' as const,
      checksum: 'a'.repeat(64),
      status: 'READY',
      totalCount: 1,
      createCount: 1,
      updateCount: 0,
      unchangedCount: 0,
      invalidCount: 0,
      failureReason: null,
      createdBy: randomUUID(),
      createdAt: new Date('2026-10-07T00:00:00.000Z'),
      publishedAt: null,
      release: null
    };
    const tx = {
      $queryRaw: async () => {
        calls.push('lock');
        return [];
      },
      importBatch: {
        findUnique: async () => {
          calls.push('read');
          return batch;
        },
        update: async () => {
          calls.push('update');
          return { ...batch, status: 'CANCELLED' };
        }
      }
    };
    const fakePrisma = {
      importBatch: tx.importBatch,
      $transaction: async (callback: (client: typeof tx) => unknown) => {
        calls.push('transaction');
        return callback(tx);
      }
    };
    const authorization = { can: async () => true };
    const service = new PlayerImportService(fakePrisma as never, authorization as never);

    const cancelled = await service.cancelBatch('actor', batchId);

    expect(cancelled.status).toBe('CANCELLED');
    expect(calls).toEqual(['transaction', 'lock', 'read', 'update']);
  });
});
