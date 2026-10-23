import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerCatalogScheduleService } from './player-catalog-schedule.service.js';

describe('PlayerCatalogScheduleService', () => {
  const prisma = new PrismaService();
  const actorId = randomUUID();
  let sourceId = '';

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.adminAccount.create({ data: {
      id: actorId, username: `schedule-${actorId}`, displayName: '定时测试',
      passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
    } });
    sourceId = (await prisma.dataSource.upsert({ where: { code: 'pesdata' }, update: { isEnabled: true },
      create: { code: 'pesdata', name: 'PESDATA', type: 'API' } })).id;
  });

  afterEach(async () => {
    await prisma.externalSyncRun.deleteMany({ where: { actorId } });
    await prisma.playerCatalogSyncSchedule.deleteMany({ where: { sourceId, actorId } });
  });

  afterAll(async () => {
    await prisma.adminAccount.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('creates only one scheduled run for the same local date', async () => {
    const service = new PlayerCatalogScheduleService(prisma, { requirePlatformAdmin: async () => ({ id: actorId }) } as never);
    await prisma.externalSyncRun.create({ data: { sourceId, actorId, mode: 'RECONCILE', status: 'READY',
      scanTrusted: true, sourceTotal: 0, businessDate: new Date('2026-10-22T00:00:00Z') } });
    await service.update(actorId, { enabled: true, timeZone: 'America/New_York', localTime: '03:00' });
    const now = new Date('2026-10-23T08:30:00Z');
    expect(await service.tick(now)).toHaveLength(1);
    expect(await service.tick(now)).toHaveLength(0);
    expect(await prisma.externalSyncRun.count({ where: { actorId, scheduleKey: 'pesdata:2026-10-23' } })).toBe(1);
  });

  it('does not start before the configured local time', async () => {
    const service = new PlayerCatalogScheduleService(prisma, { requirePlatformAdmin: async () => ({ id: actorId }) } as never);
    await prisma.externalSyncRun.create({ data: { sourceId, actorId, mode: 'RECONCILE', status: 'READY',
      scanTrusted: true, sourceTotal: 0, businessDate: new Date('2026-10-22T00:00:00Z') } });
    await service.update(actorId, { enabled: true, timeZone: 'America/New_York', localTime: '09:00' });
    expect(await service.tick(new Date('2026-10-23T08:30:00Z'))).toHaveLength(0);
  });

  it('rejects an invalid timezone', async () => {
    const service = new PlayerCatalogScheduleService(prisma, { requirePlatformAdmin: async () => ({ id: actorId }) } as never);
    await expect(service.update(actorId, { enabled: false, timeZone: 'Mars/Base', localTime: '03:00' }))
      .rejects.toThrow('INVALID_TIME_ZONE');
  });

  it('does not enable daily runs while the initial source and published catalog differ', async () => {
    await prisma.externalSyncRun.create({ data: { sourceId, actorId, mode: 'RECONCILE', status: 'READY',
      scanTrusted: true, sourceTotal: 50_000, businessDate: new Date('2026-10-22T00:00:00Z') } });
    const service = new PlayerCatalogScheduleService(prisma, { requirePlatformAdmin: async () => ({ id: actorId }) } as never);
    await expect(service.update(actorId, { enabled: true, timeZone: 'Asia/Shanghai', localTime: '03:00' }))
      .rejects.toThrow('PLAYER_CATALOG_BASELINE_REQUIRED');
  });
});
