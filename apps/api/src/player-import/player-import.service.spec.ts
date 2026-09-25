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
  const service = new PlayerImportService(prisma, authorization as never);
  const actorId = randomUUID();
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
});
