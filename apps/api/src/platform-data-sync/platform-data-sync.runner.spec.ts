import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { jest } from '@jest/globals';
import { PrismaService } from '../database/prisma.service.js';
import { PlatformDataSyncRunner } from './platform-data-sync.runner.js';

config({ path: '../../.env', quiet: true });

describe('PlatformDataSyncRunner stale lease reconciliation', () => {
  const prisma = new PrismaService();
  const sourceCode = `runner-${randomUUID()}`;
  const actorId = randomUUID();
  let sourceId = '';
  let adminId = '';

  beforeAll(async () => {
    await prisma.$connect();
    const source = await prisma.dataSource.create({
      data: { code: sourceCode, name: 'Runner test source', type: 'API' }
    });
    sourceId = source.id;
    const admin = await prisma.adminAccount.create({
      data: {
        username: `runner-${randomUUID()}`,
        displayName: '任务恢复管理员',
        passwordHash: 'unused',
        platformRole: 'PLATFORM_ADMIN'
      }
    });
    adminId = admin.id;
  });

  afterEach(async () => {
    await prisma.externalSyncRun.deleteMany({ where: { sourceId } });
    await prisma.teamCatalogSyncRun.deleteMany({ where: { actorAdminId: adminId } });
  });

  afterAll(async () => {
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await prisma.dataSource.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  });

  it.each(['PENDING', 'RUNNING'] as const)(
    'marks expired %s player and team runs interrupted and clears their leases',
    async (status) => {
      const now = new Date('2026-10-07T12:00:00.000Z');
      const expiredAt = new Date('2026-10-07T11:59:59.000Z');
      const player = await prisma.externalSyncRun.create({
        data: {
          sourceId,
          actorId,
          mode: 'INCREMENTAL',
          status,
          activeLeaseKey: `player-${randomUUID()}`,
          leaseOwnerToken: randomUUID(),
          leaseExpiresAt: expiredAt,
          currentOffset: 40,
          scannedCount: 40,
          failedCount: 3
        }
      });
      const team = await prisma.teamCatalogSyncRun.create({
        data: {
          actorAdminId: adminId,
          mode: 'INCREMENTAL',
          status,
          activeLeaseKey: `team-${randomUUID()}`,
          leaseOwnerToken: randomUUID(),
          leaseExpiresAt: expiredAt,
          currentOffset: 80,
          scannedCount: 80,
          addedCount: 50,
          failedCount: 7
        }
      });

      const result = await new PlatformDataSyncRunner(prisma).reconcileStaleRuns(now);

      expect(result).toEqual({ players: 1, teams: 1 });
      await expect(prisma.externalSyncRun.findUnique({ where: { id: player.id } })).resolves.toMatchObject({
        status: 'FAILED',
        activeLeaseKey: null,
        leaseOwnerToken: null,
        errorCode: 'PROCESS_INTERRUPTED',
        currentOffset: 40,
        scannedCount: 40,
        failedCount: 3
      });
      await expect(prisma.teamCatalogSyncRun.findUnique({ where: { id: team.id } })).resolves.toMatchObject({
        status: 'FAILED',
        activeLeaseKey: null,
        leaseOwnerToken: null,
        errorCode: 'PROCESS_INTERRUPTED',
        currentOffset: 80,
        scannedCount: 80,
        addedCount: 50,
        failedCount: 7
      });
    }
  );

  it('does not touch unexpired running leases', async () => {
    const now = new Date('2026-10-07T12:00:00.000Z');
    const future = new Date('2026-10-07T12:01:00.000Z');
    const player = await prisma.externalSyncRun.create({
      data: {
        sourceId,
        actorId,
        mode: 'FULL',
        status: 'RUNNING',
        activeLeaseKey: `player-${randomUUID()}`,
        leaseExpiresAt: future,
        currentOffset: 20
      }
    });
    const team = await prisma.teamCatalogSyncRun.create({
      data: {
        actorAdminId: adminId,
        mode: 'FULL',
        status: 'RUNNING',
        activeLeaseKey: `team-${randomUUID()}`,
        leaseExpiresAt: future,
        currentOffset: 20
      }
    });

    const result = await new PlatformDataSyncRunner(prisma).reconcileStaleRuns(now);

    expect(result).toEqual({ players: 0, teams: 0 });
    await expect(prisma.externalSyncRun.findUnique({ where: { id: player.id } })).resolves.toMatchObject({
      status: 'RUNNING', activeLeaseKey: expect.any(String), errorCode: null, currentOffset: 20
    });
    await expect(prisma.teamCatalogSyncRun.findUnique({ where: { id: team.id } })).resolves.toMatchObject({
      status: 'RUNNING', activeLeaseKey: expect.any(String), errorCode: null, currentOffset: 20
    });
  });

  it('schedules each in-process run once and contains execution failures', async () => {
    let resolvePlayer!: () => void;
    const player = {
      executePlatformRun: jest.fn(() => new Promise<void>((resolve) => { resolvePlayer = resolve; }))
    };
    const team = { executePlatformRun: jest.fn(async () => { throw new Error('upstream failed'); }) };
    const runner = new PlatformDataSyncRunner(prisma, player as never, team as never);

    runner.schedulePlayer('player-run');
    runner.schedulePlayer('player-run');
    runner.scheduleTeam('team-run');
    await Promise.resolve();

    expect(player.executePlatformRun).toHaveBeenCalledTimes(1);
    expect(team.executePlatformRun).toHaveBeenCalledTimes(1);
    resolvePlayer();
    await Promise.resolve();
  });
});
