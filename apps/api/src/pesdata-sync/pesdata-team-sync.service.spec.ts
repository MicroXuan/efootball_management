import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { PesdataClientError } from './pesdata-client.js';
import { PesdataTeamSyncService } from './pesdata-team-sync.service.js';

config({ path: '../../.env', quiet: true });

describe('PesdataTeamSyncService', () => {
  const prisma = new PrismaService();
  const adminIds: string[] = [];
  const catalogIds: string[] = [];

  beforeAll(() => prisma.$connect());
  afterEach(async () => {
    await prisma.teamCatalogSyncRun.deleteMany({ where: { actorAdminId: { in: adminIds } } });
    await prisma.teamCatalogItem.deleteMany({ where: { id: { in: catalogIds } } });
    await prisma.adminAccount.deleteMany({ where: { id: { in: adminIds } } });
    adminIds.length = 0;
    catalogIds.length = 0;
  });
  afterAll(() => prisma.$disconnect());

  async function actor() {
    const admin = await prisma.adminAccount.create({ data: {
      username: `team-sync-${randomUUID()}`, displayName: '同步管理员', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
    } });
    adminIds.push(admin.id);
    return admin;
  }

  it('stages stable team differences without publishing catalog rows', async () => {
    const admin = await actor();
    let listCalls = 0;
    const client = {
      listTeams: async () => listCalls++ === 0 ? {
        list: [
          { teamId: '10', leagueId: 'league', leagueName: '测试联赛', nameZh: '十号队', nameEn: null, nameJa: null, shortName: null, teamLogo: null, updatedAt: null },
          { teamId: '2', leagueId: 'league', leagueName: '测试联赛', nameZh: '二号队', nameEn: null, nameJa: null, shortName: null, teamLogo: null, updatedAt: null }
        ], count: 2
      } : { list: [], count: 2 },
      getTeamDetail: async (id: string) => ({
        teamId: id, leagueId: 'league', leagueName: '测试联赛', nameZh: id === '2' ? '二号队' : '十号队',
        nameEn: null, nameJa: null, shortName: null, teamLogo: null, updatedAt: null
      })
    };
    const crestLoader = { load: async () => { throw new Error('no crest expected'); } };
    const service = new PesdataTeamSyncService(prisma, client as never, crestLoader as never, { pageSize: 100 });

    const result = await service.start(admin.id, { mode: 'sample', limit: 2 });
    expect(result).toMatchObject({ status: 'READY', scannedCount: 2, addedCount: 2, updatedCount: 0, failedCount: 0 });
    await expect(prisma.teamCatalogItem.count({ where: { sourceType: 'PESDATA' } })).resolves.toBe(0);
    const staged = await prisma.teamCatalogSyncItem.findMany({ where: { runId: result.runId }, orderBy: { createdAt: 'asc' } });
    expect(staged.map(({ sourceExternalId, reviewStatus, changeType }) => ({ sourceExternalId, reviewStatus, changeType }))).toEqual([
      { sourceExternalId: '2', reviewStatus: 'PENDING', changeType: 'ADDED' },
      { sourceExternalId: '10', reviewStatus: 'PENDING', changeType: 'ADDED' }
    ]);
  });

  it('fails the run on an upstream protocol error without changing published catalog rows', async () => {
    const admin = await actor();
    const client = { listTeams: async () => { throw new PesdataClientError('PESDATA_PROTOCOL_ERROR', 'invalid', 'team-list', 200, 1); } };
    const service = new PesdataTeamSyncService(prisma, client as never, {} as never, {});

    await expect(service.start(admin.id, { mode: 'full' })).rejects.toMatchObject({ code: 'PESDATA_PROTOCOL_ERROR' });
    await expect(prisma.teamCatalogSyncRun.findFirst({ where: { actorAdminId: admin.id } })).resolves.toMatchObject({
      status: 'FAILED', activeLeaseKey: null, errorCode: 'PESDATA_PROTOCOL_ERROR'
    });
    await expect(prisma.teamCatalogItem.count({ where: { sourceType: 'PESDATA' } })).resolves.toBe(0);
  });

  it('preserves full mode across repeated resumes and skips completed source teams', async () => {
    const admin = await actor();
    const missing = await prisma.teamCatalogItem.create({ data: {
      sourceType: 'PESDATA', sourceExternalId: `missing-${randomUUID()}`, nameZh: '来源缺失队', shortName: '缺失'
    } });
    catalogIds.push(missing.id);
    let failingDetailCalls = 0;
    let completedDetailCalls = 0;
    const client = {
      listTeams: async ({ start }: { start: number }) => start === 0 ? { list: [
        { teamId: '1', leagueId: 'league', leagueName: '测试联赛', nameZh: '一号队', nameEn: null, nameJa: null, shortName: null, teamLogo: null, updatedAt: null },
        { teamId: '2', leagueId: 'league', leagueName: '测试联赛', nameZh: '二号队', nameEn: null, nameJa: null, shortName: null, teamLogo: null, updatedAt: null }
      ], count: 2 } : { list: [], count: 2 },
      getTeamDetail: async (id: string) => {
        if (id === '1') completedDetailCalls += 1;
        if (id === '2' && failingDetailCalls++ < 2) {
          throw new PesdataClientError('PESDATA_PROTOCOL_ERROR', 'invalid', 'team-detail', 200, 1);
        }
        return {
          teamId: id, leagueId: 'league', leagueName: '测试联赛', nameZh: id === '1' ? '一号队' : '二号队',
          nameEn: null, nameJa: null, shortName: null, teamLogo: null, updatedAt: null
        };
      }
    };
    const service = new PesdataTeamSyncService(prisma, client as never, {} as never, { pageSize: 2 });

    await expect(service.start(admin.id, { mode: 'full' })).rejects.toMatchObject({ code: 'PESDATA_PROTOCOL_ERROR' });
    const run = await prisma.teamCatalogSyncRun.findFirstOrThrow({ where: { actorAdminId: admin.id } });
    await expect(service.resume(admin.id, run.id)).rejects.toMatchObject({ code: 'PESDATA_PROTOCOL_ERROR' });
    await expect(service.resume(admin.id, run.id)).resolves.toMatchObject({ status: 'READY', missingCount: 1 });

    expect(completedDetailCalls).toBe(1);
    await expect(prisma.teamCatalogSyncRun.findUnique({ where: { id: run.id } })).resolves.toMatchObject({ mode: 'FULL' });
    await expect(prisma.teamCatalogItem.findUnique({ where: { id: missing.id } })).resolves.toMatchObject({ status: 'SOURCE_UNCONFIRMED' });
  });
});
