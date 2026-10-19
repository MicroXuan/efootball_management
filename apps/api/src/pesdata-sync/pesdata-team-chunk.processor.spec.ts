import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import type { PesdataTeam } from './pesdata-team.schemas.js';
import { PesdataTeamChunkProcessor } from './pesdata-team-chunk.processor.js';

config({ path: '../../.env', quiet: true });

const team = (id: string): PesdataTeam => ({
  teamId: id, leagueId: 'league', leagueName: '测试联赛', nameZh: `球队 ${id}`,
  nameEn: null, nameJa: null, shortName: null, teamLogo: null, updatedAt: null
});

describe('PesdataTeamChunkProcessor', () => {
  const prisma = new PrismaService();
  let adminId = '';
  const catalogIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    const admin = await prisma.adminAccount.create({ data: {
      username: `team-chunk-${randomUUID()}`, displayName: '球队分片测试', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
    } });
    adminId = admin.id;
  });

  afterEach(async () => {
    await prisma.teamCatalogSyncRun.deleteMany({ where: { actorAdminId: adminId } });
    await prisma.teamCatalogItem.deleteMany({ where: { id: { in: catalogIds.splice(0) } } });
  });

  afterAll(async () => {
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it('scans existing shells in 50-row chunks until the exact new-shell target is reached', async () => {
    const suffix = randomUUID();
    const existingIds = Array.from({ length: 50 }, (_, index) => `existing-${suffix}-${index}`);
    const created = await Promise.all(existingIds.map((sourceExternalId) => prisma.teamCatalogItem.create({ data: {
      sourceType: 'PESDATA', sourceExternalId, nameZh: `已有 ${sourceExternalId}`, shortName: 'OLD', status: 'ACTIVE'
    } })));
    catalogIds.push(...created.map(({ id }) => id));
    const newIds = ['new-a', 'new-b', 'new-c'].map((value) => `${value}-${suffix}`);
    const pages = [existingIds.map(team), newIds.map(team)];
    const client = {
      listTeams: async ({ start }: { start: number }) => ({ list: pages[start === 0 ? 0 : 1] ?? [], count: 53 }),
      getTeamDetail: async (id: string) => team(id)
    };
    const run = await prisma.teamCatalogSyncRun.create({ data: {
      actorAdminId: adminId, mode: 'SAMPLE', status: 'PENDING', activeLeaseKey: 'pesdata-team-catalog', requestedLimit: 2
    } });
    const processor = new PesdataTeamChunkProcessor(prisma, client as never, { load: async () => ({}) } as never);

    let outcome = await processor.processNextChunk(run.id);
    while (outcome.disposition === 'CONTINUE') outcome = await processor.processNextChunk(run.id);

    await expect(prisma.teamCatalogSyncRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({
      status: 'READY', matchedCount: 2, scannedCount: 53, completionReason: 'TARGET_REACHED'
    });
    await expect(prisma.teamCatalogSyncItem.count({ where: { runId: run.id, changeType: 'ADDED' } })).resolves.toBe(2);
  }, 30_000);

  it('creates source-missing reviews once only after a full sync reaches an empty page', async () => {
    const suffix = randomUUID();
    const missing = await prisma.teamCatalogItem.create({ data: {
      sourceType: 'PESDATA', sourceExternalId: `missing-${suffix}`, nameZh: '已消失球队', shortName: 'MIS', status: 'ACTIVE'
    } });
    catalogIds.push(missing.id);
    let listCalls = 0;
    const client = {
      listTeams: async () => listCalls++ === 0 ? { list: [team(`present-${suffix}`)], count: 1 } : { list: [], count: 1 },
      getTeamDetail: async (id: string) => team(id)
    };
    const run = await prisma.teamCatalogSyncRun.create({ data: {
      actorAdminId: adminId, mode: 'FULL', status: 'PENDING', activeLeaseKey: 'pesdata-team-catalog'
    } });
    const processor = new PesdataTeamChunkProcessor(prisma, client as never, { load: async () => ({}) } as never);

    await expect(processor.processNextChunk(run.id)).resolves.toMatchObject({ disposition: 'CONTINUE' });
    await expect(prisma.teamCatalogSyncItem.count({ where: { runId: run.id, changeType: 'SOURCE_MISSING' } })).resolves.toBe(0);
    await expect(processor.processNextChunk(run.id)).resolves.toMatchObject({ disposition: 'STOP', status: 'READY' });

    await expect(prisma.teamCatalogSyncItem.count({ where: {
      runId: run.id, sourceExternalId: missing.sourceExternalId!, changeType: 'SOURCE_MISSING'
    } })).resolves.toBe(1);
  }, 20_000);

  it('does not count a shell already pending in another run toward a sample target', async () => {
    const suffix = randomUUID();
    const pendingId = `pending-${suffix}`;
    const freshId = `fresh-${suffix}`;
    const previous = await prisma.teamCatalogSyncRun.create({ data: {
      actorAdminId: adminId, mode: 'SAMPLE', status: 'READY'
    } });
    await prisma.teamCatalogSyncItem.create({ data: {
      runId: previous.id, sourceExternalId: pendingId, summaryChecksum: 'a'.repeat(64),
      changeType: 'ADDED', reviewStatus: 'PENDING'
    } });
    const detailIds: string[] = [];
    const client = {
      listTeams: async () => ({ list: [team(pendingId), team(freshId)], count: 2 }),
      getTeamDetail: async (id: string) => { detailIds.push(id); return team(id); }
    };
    const run = await prisma.teamCatalogSyncRun.create({ data: {
      actorAdminId: adminId, mode: 'SAMPLE', status: 'PENDING',
      activeLeaseKey: 'pesdata-team-catalog', requestedLimit: 1
    } });
    const processor = new PesdataTeamChunkProcessor(prisma, client as never, { load: async () => ({}) } as never);

    await expect(processor.processNextChunk(run.id)).resolves.toMatchObject({
      disposition: 'STOP', status: 'READY', completionReason: 'TARGET_REACHED'
    });
    expect(detailIds).toEqual([freshId]);
    await expect(prisma.teamCatalogSyncRun.findUniqueOrThrow({ where: { id: run.id } })).resolves.toMatchObject({ matchedCount: 1 });
  }, 15_000);
});
