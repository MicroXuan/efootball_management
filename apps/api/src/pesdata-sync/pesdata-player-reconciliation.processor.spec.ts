import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import { PlayerCatalogScanRepository } from './player-catalog-scan.repository.js';
import { PesdataPlayerReconciliationProcessor } from './pesdata-player-reconciliation.processor.js';

describe('PesdataPlayerReconciliationProcessor', () => {
  const prisma = new PrismaService();
  const actorId = randomUUID();
  let sourceId = '';
  const createdCards: string[] = [];
  const createdPlayers: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.adminAccount.create({ data: {
      id: actorId, username: `reconcile-${actorId}`, displayName: '对账测试',
      passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
    } });
    sourceId = (await prisma.dataSource.upsert({
      where: { code: 'pesdata' }, update: { isEnabled: true },
      create: { code: 'pesdata', name: 'PESDATA', type: 'API' }
    })).id;
  });

  afterEach(async () => {
    const runs = await prisma.externalSyncRun.findMany({ where: { actorId }, select: { id: true } });
    const links = await prisma.externalSyncRunBatch.findMany({
      where: { runId: { in: runs.map(({ id }) => id) } }, select: { batchId: true }
    });
    await prisma.externalSyncRun.deleteMany({ where: { actorId } });
    await prisma.importBatch.deleteMany({ where: { id: { in: links.map(({ batchId }) => batchId) } } });
    await prisma.playerCard.deleteMany({ where: { id: { in: createdCards.splice(0) } } });
    await prisma.footballPlayer.deleteMany({ where: { id: { in: createdPlayers.splice(0) } } });
  });

  afterAll(async () => {
    await prisma.adminAccount.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('scans twice before staging a newly discovered card for review', async () => {
    const summary = { playerId: `new-${randomUUID()}`, playerName: 'New Player', position: 'CB', overall: 90,
      cardType: 3, agentTitle: 'Test Pack', agentDate: '2026-10-23' };
    const listCalls: number[] = [];
    const client = {
      listPlayers: async ({ start }: { start: number }) => {
        listCalls.push(start);
        return { list: start === 0 ? [summary] : [], count: 1 };
      },
      getPlayerDetail: async () => ({ ...summary, base_pes_id: `base-${summary.playerId}` })
    };
    const imports = new PlayerImportService(prisma, { can: async () => true } as never,
      { requirePlatformAdmin: async () => ({ id: actorId }) } as never);
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId, actorId, mode: 'RECONCILE', activeLeaseKey: 'pesdata',
      currentPhase: 'SCAN_PASS_1', businessDate: new Date('2026-10-23T00:00:00Z'), chunkSize: 1
    } });
    const processor = new PesdataPlayerReconciliationProcessor(prisma, imports, client as never,
      new PlayerCatalogScanRepository(prisma));
    for (let turn = 0; turn < 20; turn += 1) {
      const result = await processor.processNextChunk(run.id);
      if (result.disposition === 'STOP') break;
    }
    const finished = await prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(listCalls).toEqual([0, 0]);
    expect(finished).toMatchObject({ status: 'READY', scanTrusted: true });
    expect(await prisma.playerCatalogReconciliationItem.findMany({ where: { runId: run.id } }))
      .toEqual([expect.objectContaining({ externalId: summary.playerId, changeType: 'ADDED' })]);
    expect(await prisma.externalSyncRunBatch.count({ where: { runId: run.id } })).toBe(1);
  });

  it('requires absence on two adjacent trusted days when detail evidence is ambiguous', async () => {
    const externalId = `missing-${randomUUID()}`;
    const player = await prisma.footballPlayer.create({ data: { nameEn: 'Missing Player', publishedAt: new Date() } });
    createdPlayers.push(player.id);
    const card = await prisma.playerCard.create({ data: {
      sourceId, externalId, playerId: player.id, cardName: 'Missing Player', position: 'CB',
      overallRating: 90, cardType: 'STANDARD', status: 'ACTIVE', publishedAt: new Date()
    } });
    createdCards.push(card.id);
    const imports = new PlayerImportService(prisma, { can: async () => true } as never,
      { requirePlatformAdmin: async () => ({ id: actorId }) } as never);
    const client = { getPlayerDetail: async () => { throw new Error('unknown source response'); } };
    const processor = new PesdataPlayerReconciliationProcessor(prisma, imports, client as never,
      new PlayerCatalogScanRepository(prisma), { maxMissingPercent: 100 });
    for (const [date, expected] of [
      ['2026-10-22', 'REMOVAL_CANDIDATE'],
      ['2026-10-23', 'REMOVAL_CONFIRMED']
    ] as const) {
      const run = await prisma.externalSyncRun.create({ data: {
        sourceId, actorId, mode: 'RECONCILE', activeLeaseKey: 'pesdata', status: 'PENDING',
        currentPhase: 'DIFF_MISSING', scanTrusted: true, sourceTotal: 20,
        businessDate: new Date(`${date}T00:00:00Z`)
      } });
      for (let turn = 0; turn < 4; turn += 1) {
        const result = await processor.processNextChunk(run.id);
        if (result.disposition === 'STOP') break;
      }
      expect(await prisma.playerCatalogReconciliationItem.findUniqueOrThrow({
        where: { runId_externalId: { runId: run.id, externalId } }
      })).toMatchObject({ changeType: expected });
      expect(await prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } }))
        .toMatchObject({ status: 'READY' });
      expect(await prisma.externalSyncRunBatch.count({ where: { runId: run.id } }))
        .toBe(expected === 'REMOVAL_CONFIRMED' ? 1 : 0);
    }
  });

  it('does not count an anomalous empty-source day toward the two-day deletion rule', async () => {
    const externalId = `anomaly-${randomUUID()}`;
    const player = await prisma.footballPlayer.create({ data: { nameEn: 'Anomaly Player', publishedAt: new Date() } });
    createdPlayers.push(player.id);
    const card = await prisma.playerCard.create({ data: {
      sourceId, externalId, playerId: player.id, cardName: 'Anomaly Player', position: 'CB',
      overallRating: 90, cardType: 'STANDARD', status: 'ACTIVE', publishedAt: new Date()
    } });
    createdCards.push(card.id);
    const imports = new PlayerImportService(prisma, { can: async () => true } as never,
      { requirePlatformAdmin: async () => ({ id: actorId }) } as never);
    const processor = new PesdataPlayerReconciliationProcessor(prisma, imports,
      { getPlayerDetail: async () => { throw new Error('ambiguous'); } } as never,
      new PlayerCatalogScanRepository(prisma), { maxMissingPercent: 100 });
    for (const [date, total] of [['2026-10-22', 0], ['2026-10-23', 20]] as const) {
      const run = await prisma.externalSyncRun.create({ data: {
        sourceId, actorId, mode: 'RECONCILE', activeLeaseKey: 'pesdata', status: 'PENDING',
        currentPhase: 'DIFF_MISSING', scanTrusted: true, sourceTotal: total,
        businessDate: new Date(`${date}T00:00:00Z`)
      } });
      for (let turn = 0; turn < 4; turn += 1) {
        if ((await processor.processNextChunk(run.id)).disposition === 'STOP') break;
      }
      if (total === 0) {
        expect(await prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } }))
          .toMatchObject({ errorCode: 'REMOVAL_ANOMALY', skippedCount: 1 });
        expect(await prisma.playerCatalogReconciliationItem.count({ where: { runId: run.id } })).toBe(0);
      } else {
        expect(await prisma.playerCatalogReconciliationItem.findUniqueOrThrow({
          where: { runId_externalId: { runId: run.id, externalId } }
        })).toMatchObject({ changeType: 'REMOVAL_CANDIDATE' });
      }
    }
  });
});
