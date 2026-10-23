import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerCatalogScanRepository } from './player-catalog-scan.repository.js';

describe('PlayerCatalogScanRepository', () => {
  const prisma = new PrismaService();
  const actorId = randomUUID();
  let sourceId = '';

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.adminAccount.create({ data: {
      id: actorId, username: `scan-${actorId}`, displayName: '扫描测试',
      passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
    } });
    sourceId = (await prisma.dataSource.upsert({
      where: { code: 'pesdata' }, update: {},
      create: { code: 'pesdata', name: 'PESDATA', type: 'API' }
    })).id;
  });

  afterEach(async () => {
    await prisma.externalSyncRun.deleteMany({ where: { actorId } });
  });

  afterAll(async () => {
    await prisma.adminAccount.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('accepts two complete pages with exactly matching ID sets', async () => {
    const run = await prisma.externalSyncRun.create({ data: { sourceId, actorId, mode: 'FULL' } });
    const scan = new PlayerCatalogScanRepository(prisma);
    await scan.recordPage(run.id, 1, 0, 2, 2, [{ playerId: '1' }, { playerId: '2' }]);
    await scan.recordPage(run.id, 2, 0, 2, 2, [{ playerId: '2' }, { playerId: '1' }]);
    expect(await scan.verify(run.id)).toEqual({ trusted: true, sourceTotal: 2 });
  });

  it('rejects an equal-sized second pass containing a different card', async () => {
    const run = await prisma.externalSyncRun.create({ data: { sourceId, actorId, mode: 'FULL' } });
    const scan = new PlayerCatalogScanRepository(prisma);
    await scan.recordPage(run.id, 1, 0, 2, 2, [{ playerId: '1' }, { playerId: '2' }]);
    await scan.recordPage(run.id, 2, 0, 2, 2, [{ playerId: '1' }, { playerId: '3' }]);
    expect(await scan.verify(run.id)).toMatchObject({ trusted: false, reason: 'PASS_SET_MISMATCH' });
  });

  it('rejects an ID duplicated across pages', async () => {
    const run = await prisma.externalSyncRun.create({ data: { sourceId, actorId, mode: 'FULL' } });
    const scan = new PlayerCatalogScanRepository(prisma);
    await scan.recordPage(run.id, 1, 0, 1, 2, [{ playerId: '1' }]);
    await expect(scan.recordPage(run.id, 1, 1, 1, 2, [{ playerId: '1' }]))
      .rejects.toThrow('DUPLICATE_ID');
  });

  it('rejects a retry with the same ID but changed source summary', async () => {
    const run = await prisma.externalSyncRun.create({ data: { sourceId, actorId, mode: 'RECONCILE' } });
    const scan = new PlayerCatalogScanRepository(prisma);
    await scan.recordPage(run.id, 1, 0, 1, 1, [{ playerId: '1', playerName: 'Old name' }]);
    await expect(scan.recordPage(run.id, 1, 0, 1, 1, [{ playerId: '1', playerName: 'New name' }]))
      .rejects.toThrow('PAGE_CHANGED_ON_RETRY');
  });
});
