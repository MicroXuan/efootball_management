import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import type { PesdataPlayerDetail, PesdataPlayerSummary } from './pesdata.schemas.js';
import { PesdataPlayerChunkProcessor } from './pesdata-player-chunk.processor.js';
import { PesdataSyncService } from './pesdata-sync.service.js';
import { pesdataValueChecksum } from './pesdata-mapper.js';

config({ path: '../../.env', quiet: true });

function summary(id: number): PesdataPlayerSummary {
  return {
    playerId: String(id), playerName: `Player ${id}`, playerName_cn: `球员 ${id}`,
    position: 'CB', overall: 90, cardType: 3, agentTitle: 'Test Pack', agentDate: '2026-10-19'
  };
}

function detail(id: string): PesdataPlayerDetail {
  return {
    ...summary(Number(id)), playerId: id, base_pes_id: `base-${id}`,
    player_big: `https://img.example/${id}.webp`, Skills: ['Passing'], created_at: '2026-10-19 00:00:00'
  };
}

describe('PesdataPlayerChunkProcessor', () => {
  const prisma = new PrismaService();
  const adminId = randomUUID();
  let sourceId = '';
  const adminAuthorization = { requirePlatformAdmin: async (id: string) => ({ id }) };
  const imports = new PlayerImportService(prisma, { can: async () => true } as never, adminAuthorization as never);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.adminAccount.create({ data: {
      id: adminId, username: `chunk-${adminId}`, displayName: '分片测试', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
    } });
    const source = await prisma.dataSource.upsert({
      where: { code: 'pesdata' }, update: { isEnabled: true },
      create: { code: 'pesdata', name: 'PESDATA', type: 'API' }
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    const runs = await prisma.externalSyncRun.findMany({ where: { actorId: adminId }, select: { id: true } });
    const runIds = runs.map(({ id }) => id);
    const links = runIds.length ? await prisma.externalSyncRunBatch.findMany({
      where: { runId: { in: runIds } }, select: { batchId: true }
    }) : [];
    await prisma.externalSyncRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.importBatch.deleteMany({ where: { id: { in: links.map(({ batchId }) => batchId) } } });
    await prisma.importBatch.deleteMany({ where: { sourceId, createdBy: adminId } });
  });

  afterAll(async () => {
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it('continues in 50-row chunks until exactly 100 new cards are staged', async () => {
    const pages = Array.from({ length: 4 }, (_, page) =>
      Array.from({ length: 50 }, (_, index) => summary(page * 50 + index + 1))
    );
    const client = {
      listPlayers: async ({ start }: { start: number }) => ({ list: pages[start / 50] ?? [], count: 200 }),
      getPlayerDetail: async (id: string) => detail(id)
    };
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId: adminId, mode: 'SAMPLE', status: 'PENDING', activeLeaseKey: 'pesdata', requestedLimit: 100
    } });
    await prisma.importBatch.create({ data: {
      sourceId, fileName: `prior-${randomUUID()}.json`, format: 'JSON', checksum: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      status: 'READY', totalCount: 100, createCount: 100, createdBy: adminId,
      records: { create: Array.from({ length: 100 }, (_, index) => ({
        rowNumber: index + 1, externalId: String(index + 1), rawJson: {}, normalizedJson: {}, diffType: 'CREATE', fieldDiff: {}, validationErrors: {}
      })) }
    } });
    const processor = new PesdataPlayerChunkProcessor(prisma, imports, client as never);

    let outcome = await processor.processNextChunk(run.id);
    while (outcome.disposition === 'CONTINUE') outcome = await processor.processNextChunk(run.id);
    const stored = await prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } });
    const staged = await prisma.importRecord.count({ where: { batch: { syncRunLinks: { some: { runId: run.id } } } } });

    expect(stored).toMatchObject({
      status: 'READY', matchedCount: 100, scannedCount: 200, completionReason: 'TARGET_REACHED'
    });
    expect(staged).toBe(100);
  }, 45_000);

  it('finishes successfully with 60/100 when the source is exhausted', async () => {
    const players = Array.from({ length: 60 }, (_, index) => summary(10_000 + index));
    const client = {
      listPlayers: async ({ start }: { start: number }) => ({ list: players.slice(start, start + 50), count: 60 }),
      getPlayerDetail: async (id: string) => detail(id)
    };
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId: adminId, mode: 'SAMPLE', status: 'PENDING', activeLeaseKey: 'pesdata', requestedLimit: 100
    } });
    const processor = new PesdataPlayerChunkProcessor(prisma, imports, client as never);

    let outcome = await processor.processNextChunk(run.id);
    while (outcome.disposition === 'CONTINUE') outcome = await processor.processNextChunk(run.id);

    await expect(prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({
      status: 'READY', matchedCount: 60, completionReason: 'SOURCE_EXHAUSTED'
    });
  }, 30_000);

  it('skips unchanged summaries during incremental synchronization without fetching details', async () => {
    const unchanged = summary(15_001);
    const previous = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId: adminId, mode: 'INCREMENTAL', status: 'READY'
    } });
    await prisma.externalSyncItem.create({ data: {
      runId: previous.id, externalId: '15001', summaryChecksum: pesdataValueChecksum(unchanged), status: 'FETCHED'
    } });
    let detailCalls = 0;
    const client = {
      listPlayers: async ({ start }: { start: number }) => ({ list: start === 0 ? [unchanged] : [], count: 1 }),
      getPlayerDetail: async (id: string) => { detailCalls += 1; return detail(id); }
    };
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId: adminId, mode: 'INCREMENTAL', status: 'PENDING', activeLeaseKey: 'pesdata'
    } });
    const processor = new PesdataPlayerChunkProcessor(prisma, imports, client as never);

    let outcome = await processor.processNextChunk(run.id);
    while (outcome.disposition === 'CONTINUE') outcome = await processor.processNextChunk(run.id);

    expect(detailCalls).toBe(0);
    await expect(prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({
      status: 'READY', scannedCount: 1, fetchedCount: 0, skippedCount: 1,
      chunkIndex: 2, completionReason: 'SOURCE_EXHAUSTED'
    });
  }, 20_000);

  it('clamps the final chunk to the remaining target and exposes its review batch immediately', async () => {
    let detailCalls = 0;
    const players = Array.from({ length: 12 }, (_, index) => summary(20_000 + index));
    const client = {
      listPlayers: async () => ({ list: players, count: 12 }),
      getPlayerDetail: async (id: string) => { detailCalls += 1; return detail(id); }
    };
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId: adminId, mode: 'SAMPLE', status: 'PENDING', activeLeaseKey: 'pesdata',
      requestedLimit: 100, matchedCount: 97
    } });
    const processor = new PesdataPlayerChunkProcessor(prisma, imports, client as never);

    await expect(processor.processNextChunk(run.id)).resolves.toEqual({
      disposition: 'STOP', status: 'READY', completionReason: 'TARGET_REACHED'
    });
    const links = await prisma.externalSyncRunBatch.findMany({ where: { runId: run.id }, include: { batch: true } });

    expect(detailCalls).toBe(3);
    expect(links).toHaveLength(1);
    expect(links[0]?.batch).toMatchObject({ status: 'READY', totalCount: 3 });
  }, 15_000);

  it('does not move the checkpoint or create a batch after lease ownership is lost', async () => {
    let releaseDetail!: () => void;
    let detailStarted!: () => void;
    const started = new Promise<void>((resolve) => { detailStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseDetail = resolve; });
    const client = {
      listPlayers: async () => ({ list: [summary(30_001)], count: 1 }),
      getPlayerDetail: async (id: string) => { detailStarted(); await blocked; return detail(id); }
    };
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId: adminId, mode: 'SAMPLE', status: 'PENDING', activeLeaseKey: 'pesdata', requestedLimit: 1
    } });
    const processor = new PesdataPlayerChunkProcessor(prisma, imports, client as never);
    const execution = processor.processNextChunk(run.id);
    await started;
    await prisma.externalSyncRun.update({ where: { id: run.id }, data: {
      status: 'FAILED', activeLeaseKey: null, leaseOwnerToken: null, leaseExpiresAt: null
    } });
    releaseDetail();

    await expect(execution).rejects.toMatchObject({ code: 'PESDATA_SYNC_LEASE_LOST' });
    await expect(prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({
      currentOffset: 0, matchedCount: 0, scannedCount: 0
    });
    await expect(prisma.externalSyncRunBatch.count({ where: { runId: run.id } })).resolves.toBe(0);
  }, 15_000);

  it('commits the current chunk and then pauses without fetching another page', async () => {
    let releaseDetail!: () => void;
    let detailStarted!: () => void;
    const started = new Promise<void>((resolve) => { detailStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseDetail = resolve; });
    let listCalls = 0;
    const client = {
      listPlayers: async () => { listCalls += 1; return { list: [summary(40_001)], count: 100 }; },
      getPlayerDetail: async (id: string) => { detailStarted(); await blocked; return detail(id); }
    };
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId: adminId, mode: 'SAMPLE', status: 'PENDING', activeLeaseKey: 'pesdata', requestedLimit: 100
    } });
    const processor = new PesdataPlayerChunkProcessor(prisma, imports, client as never);
    const controls = new PesdataSyncService(prisma, imports, client as never);
    const execution = processor.processNextChunk(run.id);
    await started;

    await expect(controls.pausePlatformRun(adminId, run.id)).resolves.toEqual({
      runId: run.id, status: 'PAUSING'
    });
    releaseDetail();
    await expect(execution).resolves.toMatchObject({ disposition: 'STOP', status: 'PAUSED' });

    expect(listCalls).toBe(1);
    await expect(prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({
      status: 'PAUSED', matchedCount: 1, currentOffset: 1
    });
  }, 15_000);

  it('cancels an inactive run without deleting its ready review batch', async () => {
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId: adminId, mode: 'INCREMENTAL', status: 'PAUSED', activeLeaseKey: 'pesdata'
    } });
    const batch = await prisma.importBatch.create({ data: {
      sourceId, fileName: `preserved-${randomUUID()}.json`, format: 'JSON',
      checksum: randomUUID().replaceAll('-', '').padEnd(64, '0'), status: 'READY', totalCount: 1, createCount: 1, createdBy: adminId,
      records: { create: {
        rowNumber: 1, externalId: 'preserved-card', rawJson: {}, normalizedJson: {}, diffType: 'CREATE', fieldDiff: {}, validationErrors: {}
      } },
      syncRunLinks: { create: { runId: run.id, chunkIndex: 1 } }
    } });
    const controls = new PesdataSyncService(prisma, imports, {
      listPlayers: async () => ({ list: [], count: 0 }), getPlayerDetail: async (id: string) => detail(id)
    } as never);

    await expect(controls.cancelPlatformRun(adminId, run.id)).resolves.toEqual({ runId: run.id, status: 'CANCELLED' });
    await expect(prisma.importBatch.findUnique({ where: { id: batch.id } })).resolves.toMatchObject({ status: 'READY' });
    await expect(prisma.externalSyncRunBatch.count({ where: { runId: run.id, batchId: batch.id } })).resolves.toBe(1);
  }, 15_000);
});
