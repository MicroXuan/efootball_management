import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { config } from 'dotenv';
import { jest } from '@jest/globals';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  executePlayerImportPublication,
  PLAYER_IMPORT_PUBLICATION_TIMEOUT_MS,
  PlayerImportPublisher,
  preparePlayerImportPublication
} from './player-import.publisher.js';
import { PlayerImportService } from './player-import.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';

config({ path: '../../.env', quiet: true });

describe('PlayerImportPublisher', () => {
  jest.setTimeout(70_000);
  const prisma = new PrismaService();
  const userAuthorizationCalls: Array<[string, string]> = [];
  const authorization = { can: async (id: string, permission: string) => {
    userAuthorizationCalls.push([id, permission]);
    return true;
  } };
  const platformAuthorizationCalls: string[] = [];
  const adminAuthorization = { requirePlatformAdmin: async (id: string) => {
    platformAuthorizationCalls.push(id);
    return { id };
  } };
  const service = new PlayerImportService(prisma, authorization as never, adminAuthorization as never);
  const publisher = new PlayerImportPublisher(prisma, authorization as never, adminAuthorization as never);
  const actorId = randomUUID();
  const adminId = randomUUID();
  let sourceId: string;
  let sourceCode: string;

  const card = (externalId: string, overrides: Record<string, unknown> = {}) => ({
    externalId,
    playerExternalId: `player-${externalId}`,
    playerNameEn: `Publisher Test ${externalId}`,
    playerNameZh: `发布测试 ${externalId}`,
    nationality: 'Argentina',
    club: 'Test FC',
    clubZh: '测试足球俱乐部',
    clubEn: 'Test FC',
    cardName: 'Featured',
    position: 'CMF',
    overallRating: 95,
    cardType: 'FEATURED',
    status: 'ACTIVE',
    packExternalId: `pack-${externalId}`,
    packName: `Pack ${externalId}`,
    season: 'S1',
    releaseDate: '2026-09-24',
    skills: [`Passing ${externalId}`],
    attributes: { passing: 96 },
    ...overrides
  });

  const createBatch = (rows: unknown[]) => service.createBatch(actorId, {
    sourceCode,
    fileName: `${randomUUID()}.json`,
    format: 'JSON',
    content: JSON.stringify(rows)
  });

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: { id: actorId, wechatOpenId: `publisher-test-${actorId}`, displayName: '发布测试员' }
    });
    await prisma.adminAccount.create({
      data: { id: adminId, username: `publisher-admin-${adminId}`, displayName: '发布管理员', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN' }
    });
  });

  beforeEach(async () => {
    userAuthorizationCalls.length = 0;
    platformAuthorizationCalls.length = 0;
    sourceId = '';
    sourceCode = `publisher-${randomUUID()}`;
    const source = await prisma.dataSource.create({ data: { code: sourceCode, name: 'Publisher test' } });
    sourceId = source.id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { actorAdminId: adminId } });
    if (!sourceId) return;
    const cards = await prisma.playerCard.findMany({
      where: { sourceId },
      select: { id: true, playerId: true, skills: { select: { skillId: true } } }
    });
    const cardIds = cards.map(({ id }) => id);
    const playerIds = [...new Set(cards.map(({ playerId }) => playerId))];
    const skillIds = [...new Set(cards.flatMap(({ skills }) => skills.map(({ skillId }) => skillId)))];
    if (playerIds.length) {
      await prisma.footballPlayerBestCard.deleteMany({ where: { footballPlayerId: { in: playerIds } } });
    }
    if (cardIds.length) await prisma.playerCardAutoBuild.deleteMany({ where: { playerCardId: { in: cardIds } } });
    if (cardIds.length) await prisma.playerCardVersion.deleteMany({ where: { playerCardId: { in: cardIds } } });
    await prisma.catalogRelease.deleteMany({ where: { batch: { sourceId } } });
    await prisma.importBatch.deleteMany({ where: { sourceId } });
    await prisma.playerCard.deleteMany({ where: { sourceId } });
    await prisma.cardPack.deleteMany({ where: { sourceId } });
    await prisma.footballPlayerSource.deleteMany({ where: { sourceId } });
    if (playerIds.length) await prisma.footballPlayer.deleteMany({ where: { id: { in: playerIds } } });
    if (skillIds.length) {
      await prisma.skill.deleteMany({ where: { id: { in: skillIds }, cards: { none: {} } } });
    }
    await prisma.dataSource.delete({ where: { id: sourceId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: actorId } });
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it('publishes a complete CREATE graph and immutable version', async () => {
    const batch = await createBatch([card('create')]);
    const published = await publisher.publish(actorId, batch.id);
    const stored = await prisma.playerCard.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: 'create' } },
      include: { player: { include: { sources: true } }, cardPack: true, skills: true, attributes: true, versions: true }
    });

    expect(published.status).toBe('PUBLISHED');
    expect(published.releaseSequence).toBeGreaterThan(0);
    expect(stored?.player.sources).toHaveLength(1);
    expect(stored?.player as unknown as Record<string, unknown>).toMatchObject({
      club: 'Test FC', clubZh: '测试足球俱乐部', clubEn: 'Test FC'
    });
    expect(stored?.cardPack?.externalId).toBe('pack-create');
    expect(stored?.skills).toHaveLength(1);
    expect(stored?.attributes?.attributesJson).toEqual({ passing: 96 });
    expect(stored?.versions).toHaveLength(1);
    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(1);
  });

  it('publishes for a platform administrator without checking user scopes', async () => {
    const batch = await createBatch([card('platform-publish')]);
    userAuthorizationCalls.length = 0;

    const published = await publisher.publishForPlatformAdmin(adminId, batch.id);

    expect(published.status).toBe('PUBLISHED');
    expect(platformAuthorizationCalls).toEqual([adminId]);
    expect(userAuthorizationCalls).toEqual([]);
  });

  it('keeps ordinary publication on user scope authorization', async () => {
    const batch = await createBatch([card('user-publish')]);
    userAuthorizationCalls.length = 0;

    await publisher.publish(actorId, batch.id);

    expect(userAuthorizationCalls).toContainEqual([actorId, 'catalog.import.publish']);
    expect(platformAuthorizationCalls).toEqual([]);
  });

  it('persists a source-provided automatic build and refreshes the recommended card', async () => {
    const batch = await createBatch([card('auto-build', {
      autoBuildAllocation: { defending: 12, aerialStrength: 8 },
      autoBuildMaxOverall: 98,
      dtRating: 97,
      algorithmVersion: 'pesdata-auto-v1'
    })]);

    await publisher.publish(actorId, batch.id);

    const stored = await prisma.playerCard.findUniqueOrThrow({
      where: { sourceId_externalId: { sourceId, externalId: 'auto-build' } },
      include: { autoBuilds: true, player: { include: { bestCard: true } } }
    });
    expect(stored.autoBuilds).toHaveLength(1);
    expect(stored.autoBuilds[0]).toMatchObject({ maxOverall: 98, dtRating: 97 });
    expect(stored.player.bestCard?.playerCardId).toBe(stored.id);
  });

  it('publishes ten cards with one hundred skills within thirty seconds', async () => {
    const rows = Array.from({ length: 10 }, (_, cardIndex) => card(`bulk-${cardIndex}`, {
      skills: Array.from({ length: 10 }, (_, skillIndex) => `Bulk Skill ${cardIndex}-${skillIndex}`)
    }));
    const batch = await createBatch(rows);

    const startedAt = performance.now();
    const published = await publisher.publish(actorId, batch.id);
    const elapsedMs = performance.now() - startedAt;

    expect(published.status).toBe('PUBLISHED');
    expect(elapsedMs).toBeLessThan(30_000);
    await expect(prisma.playerCard.count({ where: { sourceId } })).resolves.toBe(10);
    await expect(prisma.playerCardSkill.count({
      where: { playerCard: { sourceId } }
    })).resolves.toBe(100);
    await expect(prisma.playerCardVersion.count({ where: { playerCard: { sourceId } } })).resolves.toBe(10);
    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(1);
  }, 35_000);

  it('publishes fifty cards with five hundred skill links within thirty seconds', async () => {
    const rows = Array.from({ length: 50 }, (_, cardIndex) => card(`stress-${cardIndex}`, {
      skills: Array.from({ length: 10 }, (_, skillIndex) => `Stress Skill ${cardIndex}-${skillIndex}`),
      autoBuildAllocation: { passing: 8, defending: 4 },
      autoBuildMaxOverall: 98,
      dtRating: 97,
      algorithmVersion: 'pesdata-auto-v1'
    }));
    const batch = await createBatch(rows);

    const startedAt = performance.now();
    const published = await publisher.publish(actorId, batch.id);
    const elapsedMs = performance.now() - startedAt;

    expect(published.status).toBe('PUBLISHED');
    expect(elapsedMs).toBeLessThan(30_000);
    await expect(prisma.playerCard.count({ where: { sourceId } })).resolves.toBe(50);
    await expect(prisma.playerCardSkill.count({
      where: { playerCard: { sourceId } }
    })).resolves.toBe(500);
    await expect(prisma.playerCardVersion.count({ where: { playerCard: { sourceId } } })).resolves.toBe(50);
    await expect(prisma.playerCardAutoBuild.count({ where: { playerCard: { sourceId } } })).resolves.toBe(50);
    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(1);
  }, 70_000);

  it('uses a sixty-second transaction timeout', async () => {
    let transactionOptions: { timeout?: number } | undefined;
    const timestamp = new Date('2026-10-19T12:00:00.000Z');
    const batchId = randomUUID();
    const timeoutSourceId = randomUUID();
    const ready = {
      id: batchId, sourceId: timeoutSourceId, fileName: 'timeout.json',
      format: 'JSON' as const, checksum: 'a'.repeat(64), status: 'READY' as const,
      totalCount: 0, createCount: 0, updateCount: 0, unchangedCount: 0, invalidCount: 0,
      failureReason: null, createdBy: actorId, publishedAt: null, createdAt: timestamp, updatedAt: timestamp,
      source: { id: timeoutSourceId, code: 'timeout-option' }, release: null, records: []
    };
    const published = {
      ...ready,
      status: 'PUBLISHED' as const,
      publishedAt: timestamp,
      release: {
        id: randomUUID(), sequence: 1, batchId: ready.id, publishedBy: actorId,
        createdCount: 0, updatedCount: 0, unchangedCount: 0, publishedAt: timestamp
      }
    };
    const fakePrisma = {
      importBatch: { findUnique: async () => ready },
      $transaction: async (_callback: unknown, options: { timeout?: number }) => {
        transactionOptions = options;
        return published;
      }
    };
    const timeoutPublisher = new PlayerImportPublisher(
      fakePrisma as never,
      authorization as never,
      adminAuthorization as never
    );

    await timeoutPublisher.publish(actorId, ready.id);

    expect(transactionOptions).toEqual({ timeout: 60_000 });
    expect(PLAYER_IMPORT_PUBLICATION_TIMEOUT_MS).toBe(60_000);
  });

  it('returns a specific retry-safe error when the publication transaction expires', async () => {
    const timeout = new Prisma.PrismaClientKnownRequestError('transaction expired', {
      code: 'P2028',
      clientVersion: 'test',
      meta: { operation: 'query', timeout: 60_000 }
    });
    const timestamp = new Date('2026-10-19T12:00:00.000Z');
    const timeoutBatchId = randomUUID();
    const timeoutSourceId = randomUUID();
    const ready = {
      id: timeoutBatchId, sourceId: timeoutSourceId, fileName: 'timeout.json',
      format: 'JSON' as const, checksum: 'b'.repeat(64), status: 'READY' as const,
      totalCount: 0, createCount: 0, updateCount: 0, unchangedCount: 0, invalidCount: 0,
      failureReason: null, createdBy: actorId, publishedAt: null, createdAt: timestamp, updatedAt: timestamp,
      records: []
    };
    const timedOutPublisher = new PlayerImportPublisher(
      {
        importBatch: { findUnique: async () => ready },
        $transaction: async () => { throw timeout; }
      } as never,
      authorization as never,
      adminAuthorization as never
    );

    await expect(timedOutPublisher.publishForPlatformAdmin(adminId, timeoutBatchId)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'IMPORT_PUBLISH_TIMEOUT',
        message: '批次发布超时，数据已回滚，可安全重试'
      }
    });
  });

  it('updates only reviewed source fields and preserves omitted cards', async () => {
    const initial = await createBatch([card('keep'), card('update')]);
    await publisher.publish(actorId, initial.id);
    const update = await createBatch([card('update', { overallRating: 97 })]);

    await publisher.publish(actorId, update.id);

    const kept = await prisma.playerCard.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: 'keep' } }
    });
    const changed = await prisma.playerCard.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: 'update' } }
    });
    expect(kept?.status).toBe('ACTIVE');
    expect(changed?.overallRating).toBe(97);
    expect(changed?.cardName).toBe('Featured');
  });

  it('updates only reviewed source fields and clears reviewed pack and skills', async () => {
    const initial = await createBatch([card('clear-reviewed', {
      skills: ['Passing', 'Through Passing'],
      packExternalId: 'pack-clear-reviewed',
      packName: 'Clear Pack'
    })]);
    await publisher.publish(actorId, initial.id);
    const update = await createBatch([card('clear-reviewed', {
      skills: [],
      packExternalId: undefined,
      packName: undefined,
      season: undefined,
      releaseDate: undefined
    })]);

    await publisher.publish(actorId, update.id);

    const stored = await prisma.playerCard.findUniqueOrThrow({
      where: { sourceId_externalId: { sourceId, externalId: 'clear-reviewed' } },
      include: { skills: true }
    });
    expect(stored.cardPackId).toBeNull();
    expect(stored.skills).toEqual([]);
    expect(stored.cardName).toBe('Featured');
  });

  it('bulk publication preserves mixed create update unchanged and clear semantics', async () => {
    const originalRows = [
      card('mixed-field'),
      card('mixed-skills', { skills: ['Passing', 'Through Passing'] }),
      card('mixed-pack', { packExternalId: 'mixed-pack-id', packName: 'Mixed Pack' }),
      card('mixed-unchanged')
    ];
    const initial = await createBatch(originalRows);
    await publisher.publish(actorId, initial.id);
    const mixed = await createBatch([
      card('mixed-field', { overallRating: 99 }),
      card('mixed-skills', { skills: [] }),
      card('mixed-pack', {
        packExternalId: undefined,
        packName: undefined,
        season: undefined,
        releaseDate: undefined
      }),
      card('mixed-unchanged'),
      card('mixed-new')
    ]);
    const mixedDiffs = await prisma.importRecord.findMany({
      where: { batchId: mixed.id },
      orderBy: { rowNumber: 'asc' },
      select: { externalId: true, diffType: true, fieldDiff: true }
    });

    expect(mixedDiffs).toEqual([
      expect.objectContaining({ externalId: 'mixed-field', diffType: 'UPDATE' }),
      expect.objectContaining({ externalId: 'mixed-skills', diffType: 'UPDATE' }),
      expect.objectContaining({ externalId: 'mixed-pack', diffType: 'UPDATE' }),
      { externalId: 'mixed-unchanged', diffType: 'UNCHANGED', fieldDiff: {} },
      expect.objectContaining({ externalId: 'mixed-new', diffType: 'CREATE' })
    ]);

    const published = await publisher.publish(actorId, mixed.id);

    expect(published).toMatchObject({ createCount: 1, updateCount: 3, unchangedCount: 1 });
    await expect(prisma.playerCard.count({ where: { sourceId } })).resolves.toBe(5);
    await expect(prisma.catalogRelease.count({ where: { batch: { sourceId } } })).resolves.toBe(2);
    await expect(prisma.playerCardVersion.count({ where: { playerCard: { sourceId } } })).resolves.toBe(8);
    const stored = await prisma.playerCard.findMany({
      where: { sourceId },
      include: { skills: true, versions: true }
    });
    const byExternalId = new Map(stored.map((entry) => [entry.externalId, entry]));
    expect(byExternalId.get('mixed-field')).toMatchObject({ overallRating: 99 });
    expect(byExternalId.get('mixed-field')?.versions).toHaveLength(2);
    expect(byExternalId.get('mixed-skills')?.skills).toEqual([]);
    expect(byExternalId.get('mixed-pack')?.cardPackId).toBeNull();
    expect(byExternalId.get('mixed-unchanged')?.versions).toHaveLength(1);
    expect(byExternalId.get('mixed-new')?.versions).toHaveLength(1);
  });

  it('rejects a stale transaction-external publication snapshot', async () => {
    const batch = await createBatch([card('stale-snapshot')]);
    const prepared = await preparePlayerImportPublication(prisma, batch.id);
    const stored = await prisma.importRecord.findFirstOrThrow({ where: { batchId: batch.id } });
    await prisma.importRecord.update({
      where: { id: stored.id },
      data: {
        normalizedJson: {
          ...(stored.normalizedJson as Record<string, Prisma.JsonValue>),
          overallRating: 96
        }
      }
    });

    await expect(prisma.$transaction((tx) => executePlayerImportPublication(tx, {
      actorId,
      batchId: batch.id,
      platformAdmin: false,
      preparedRecords: prepared.preparedRecords,
      snapshotKey: prepared.snapshotKey
    }), { timeout: 60_000 })).rejects.toMatchObject({ code: 'IMPORT_BATCH_NOT_READY' });

    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(0);
    await expect(prisma.playerCard.count({ where: { sourceId } })).resolves.toBe(0);
  });

  it('rejects invalid and cancelled batches', async () => {
    const invalid = await createBatch([card('duplicate'), card('duplicate')]);
    await expect(publisher.publish(actorId, invalid.id)).rejects.toMatchObject({ code: 'IMPORT_BATCH_NOT_READY' });

    const cancelled = await createBatch([card('cancelled')]);
    await service.cancelBatch(actorId, cancelled.id);
    await expect(publisher.publish(actorId, cancelled.id)).rejects.toMatchObject({ code: 'IMPORT_BATCH_NOT_READY' });
  });

  it('publishes an explicit INACTIVE update', async () => {
    const initial = await createBatch([card('inactive')]);
    await publisher.publish(actorId, initial.id);
    const inactive = await createBatch([card('inactive', { status: 'INACTIVE' })]);

    await publisher.publish(actorId, inactive.id);

    await expect(prisma.playerCard.findUnique({
      where: { sourceId_externalId: { sourceId, externalId: 'inactive' } },
      select: { status: true }
    })).resolves.toEqual({ status: 'INACTIVE' });
  });

  it('rolls back release and formal rows when a later record fails', async () => {
    const batch = await createBatch([card('rollback-a'), card('rollback-b')]);
    const second = await prisma.importRecord.findFirstOrThrow({
      where: { batchId: batch.id, rowNumber: 2 }
    });
    await prisma.importRecord.update({
      where: { id: second.id },
      data: { normalizedJson: Prisma.JsonNull }
    });

    await expect(publisher.publish(actorId, batch.id)).rejects.toThrow();

    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(0);
    await expect(prisma.playerCard.count({ where: { sourceId } })).resolves.toBe(0);
    await expect(prisma.importBatch.findUnique({ where: { id: batch.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'READY' });
  });

  it('rolls back every formal row when bulk writing fails', async () => {
    const batch = await createBatch([card('bulk-rollback-a'), card('bulk-rollback-b')]);
    const prepared = await preparePlayerImportPublication(prisma, batch.id);
    let writeCount = 0;

    await expect(prisma.$transaction(async (tx) => {
      const failingTx = new Proxy(tx, {
        get(target, key, receiver) {
          if (key !== '$executeRaw') return Reflect.get(target, key, receiver);
          return async (...args: unknown[]) => {
            writeCount += 1;
            if (writeCount === 4) throw new Error('forced bulk write failure');
            return (target.$executeRaw as (...values: unknown[]) => Promise<number>).apply(target, args);
          };
        }
      });
      return executePlayerImportPublication(failingTx, {
        actorId,
        batchId: batch.id,
        platformAdmin: false,
        preparedRecords: prepared.preparedRecords,
        snapshotKey: prepared.snapshotKey
      });
    }, { timeout: 60_000 })).rejects.toThrow('forced bulk write failure');

    expect(writeCount).toBe(4);
    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(0);
    await expect(prisma.playerCard.count({ where: { sourceId } })).resolves.toBe(0);
    await expect(prisma.footballPlayerSource.count({ where: { sourceId } })).resolves.toBe(0);
    await expect(prisma.importBatch.findUnique({ where: { id: batch.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'READY' });
  });

  it('returns one release for concurrent publish calls', async () => {
    const batch = await createBatch([card('concurrent')]);

    const [left, right] = await Promise.all([
      publisher.publish(actorId, batch.id),
      publisher.publish(actorId, batch.id)
    ]);

    expect(left.releaseId).toBe(right.releaseId);
    await expect(prisma.catalogRelease.count({ where: { batchId: batch.id } })).resolves.toBe(1);
  });

  it('serializes concurrent publish and cancellation without leaving contradictory data', async () => {
    const batch = await createBatch([card('publish-cancel-race')]);

    const outcomes = await Promise.allSettled([
      publisher.publish(actorId, batch.id),
      service.cancelBatch(actorId, batch.id)
    ]);
    const stored = await prisma.importBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { release: true }
    });
    const cardCount = await prisma.playerCard.count({
      where: { sourceId, externalId: 'publish-cancel-race' }
    });

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    if (stored.status === 'PUBLISHED') {
      expect(stored.release).not.toBeNull();
      expect(cardCount).toBe(1);
    } else {
      expect(stored.status).toBe('CANCELLED');
      expect(stored.release).toBeNull();
      expect(cardCount).toBe(0);
    }
  });

  it('commits platform publication and rejection audits in their domain transactions', async () => {
    const audit = new AuditLogService(prisma);
    const auditedPublisher = new PlayerImportPublisher(prisma, authorization as never, adminAuthorization as never, audit);
    const auditedService = new PlayerImportService(prisma, authorization as never, adminAuthorization as never, audit);
    const publishBatch = await createBatch([card('audited-publish')]);
    const rejectBatch = await createBatch([card('audited-reject')]);

    await auditedPublisher.publishForPlatformAdmin(adminId, publishBatch.id);
    await auditedService.cancelBatchForPlatformAdmin(adminId, rejectBatch.id);

    const actions = await prisma.auditLog.findMany({
      where: { actorAdminId: adminId, resourceId: { in: [publishBatch.id, rejectBatch.id] } },
      orderBy: { createdAt: 'asc' },
      select: { action: true }
    });
    expect(actions.map(({ action }) => action)).toEqual(expect.arrayContaining([
      'PUBLISH_PLAYER_CARD_IMPORT_BATCH',
      'REJECT_PLAYER_CARD_IMPORT_BATCH'
    ]));
    expect(actions).toHaveLength(2);
  });

  it('rolls back platform publication and rejection when their audit write fails', async () => {
    const failingAudit = { record: async () => { throw new Error('audit unavailable'); } };
    const auditedPublisher = new PlayerImportPublisher(prisma, authorization as never, adminAuthorization as never, failingAudit as never);
    const auditedService = new PlayerImportService(prisma, authorization as never, adminAuthorization as never, failingAudit as never);
    const publishBatch = await createBatch([card('audit-rollback-publish')]);
    const rejectBatch = await createBatch([card('audit-rollback-reject')]);

    await expect(auditedPublisher.publishForPlatformAdmin(adminId, publishBatch.id)).rejects.toThrow('audit unavailable');
    await expect(auditedService.cancelBatchForPlatformAdmin(adminId, rejectBatch.id)).rejects.toThrow('audit unavailable');

    await expect(prisma.importBatch.findUnique({ where: { id: publishBatch.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'READY' });
    await expect(prisma.catalogRelease.count({ where: { batchId: publishBatch.id } })).resolves.toBe(0);
    await expect(prisma.playerCard.count({ where: { sourceId, externalId: 'audit-rollback-publish' } })).resolves.toBe(0);
    await expect(prisma.importBatch.findUnique({ where: { id: rejectBatch.id }, select: { status: true } }))
      .resolves.toEqual({ status: 'READY' });
  });
});
