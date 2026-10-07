import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import { PesdataClientError } from './pesdata-client.js';
import { mapPesdataPlayer } from './pesdata-mapper.js';
import type { PesdataPlayerDetail, PesdataPlayerSummary } from './pesdata.schemas.js';
import { PesdataSyncService } from './pesdata-sync.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';

config({ path: '../../.env', quiet: true });

function summary(id: number): PesdataPlayerSummary {
  return {
    playerId: String(id),
    playerName: `Player ${id}`,
    playerName_cn: `球员 ${id}`,
    position: 'CB',
    overall: 90,
    cardType: 3,
    agentTitle: 'Test Pack',
    agentDate: '2026-09-25'
  };
}

function detail(id: string): PesdataPlayerDetail {
  return {
    ...summary(Number(id)),
    playerId: id,
    base_pes_id: `base-${id}`,
    player_big: `https://img.example/${id}.webp`,
    Skills: ['Passing'],
    created_at: '2026-09-25 00:00:00'
  };
}

describe('PesdataSyncService', () => {
  const prisma = new PrismaService();
  const actorId = randomUUID();
  const adminId = randomUUID();
  const authorization = { can: async () => true };
  const adminAuthorization = { requirePlatformAdmin: async (id: string) => ({ id }) };
  const importService = new PlayerImportService(prisma, authorization as never, adminAuthorization as never);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: { id: actorId, wechatOpenId: `pesdata-sync-${actorId}`, displayName: '同步测试员' }
    });
    await prisma.adminAccount.create({
      data: { id: adminId, username: `pesdata-admin-${adminId}`, displayName: '同步管理员', passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN' }
    });
    await prisma.dataSource.upsert({
      where: { code: 'pesdata' },
      update: { isEnabled: true },
      create: { code: 'pesdata', name: 'PESDATA test source', type: 'API' }
    });
  });

  afterEach(async () => {
    const source = await prisma.dataSource.findUniqueOrThrow({ where: { code: 'pesdata' } });
    await prisma.importBatch.deleteMany({ where: { sourceId: source.id, createdBy: actorId } });
    await prisma.externalSyncRun.deleteMany({ where: { sourceId: source.id, actorId: { in: [actorId, adminId] } } });
    await prisma.auditLog.deleteMany({ where: { actorAdminId: adminId } });
  });

  it('queues a platform run, reserves one lease, and renews progress while executing', async () => {
    const listOffsets: number[] = [];
    const client = {
      listPlayers: async ({ start }: { start: number }) => {
        listOffsets.push(start);
        return start === 0 ? { list: [summary(901)], count: 1 } : { list: [], count: 1 };
      },
      getPlayerDetail: async (id: string) => detail(id)
    };
    const sync = new PesdataSyncService(prisma, importService, client as never, { pageSize: 1 });

    const queued = await sync.createPlatformRun(adminId, { mode: 'incremental' });
    await expect(sync.createPlatformRun(adminId, { mode: 'full' }))
      .rejects.toMatchObject({ code: 'PESDATA_SYNC_CONFLICT' });
    const result = await sync.executePlatformRun(queued.runId);
    const run = await prisma.externalSyncRun.findUniqueOrThrow({ where: { id: queued.runId } });

    expect(queued).toEqual({ runId: expect.any(String), status: 'PENDING' });
    expect(result.status).toBe('READY');
    expect(listOffsets).toEqual([0, 1]);
    expect(run).toMatchObject({
      status: 'READY',
      activeLeaseKey: null,
      leaseExpiresAt: null,
      currentPhase: 'READY',
      currentOffset: 1,
      scannedCount: 1
    });
    expect(run.heartbeatAt).toBeInstanceOf(Date);
  });

  it('renews the lease independently while an upstream request is still pending', async () => {
    let releaseRequest!: () => void;
    let requestStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseRequest = resolve; });
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    const client = {
      listPlayers: async () => {
        requestStarted();
        await blocked;
        return { list: [], count: 0 };
      },
      getPlayerDetail: async (id: string) => detail(id)
    };
    const sync = new PesdataSyncService(prisma, importService, client as never, {
      pageSize: 1,
      heartbeatIntervalMs: 5
    });
    const queued = await sync.createPlatformRun(adminId, { mode: 'incremental' });
    const execution = sync.executePlatformRun(queued.runId);
    await started;
    const before = await prisma.externalSyncRun.findUniqueOrThrow({ where: { id: queued.runId } });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const during = await prisma.externalSyncRun.findUniqueOrThrow({ where: { id: queued.runId } });
    releaseRequest();
    await execution;

    expect(during.heartbeatAt!.getTime()).toBeGreaterThan(before.heartbeatAt!.getTime());
    expect(during.leaseOwnerToken).not.toBeNull();
  });

  it('stops a pending worker after its heartbeat detects lease ownership loss', async () => {
    let releaseRequest!: () => void;
    let requestStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseRequest = resolve; });
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    const client = {
      listPlayers: async () => {
        requestStarted();
        await blocked;
        return { list: [], count: 0 };
      },
      getPlayerDetail: async (id: string) => detail(id)
    };
    const sync = new PesdataSyncService(prisma, importService, client as never, {
      pageSize: 1,
      heartbeatIntervalMs: 5
    });
    const queued = await sync.createPlatformRun(adminId, { mode: 'incremental' });
    const execution = sync.executePlatformRun(queued.runId);
    const outcome = execution.then((value) => ({ value }), (error: unknown) => ({ error }));
    await started;
    await prisma.externalSyncRun.update({ where: { id: queued.runId }, data: {
      status: 'FAILED', activeLeaseKey: null, leaseOwnerToken: null, leaseExpiresAt: null
    } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseRequest();
    const settled = await outcome;

    expect(settled).toMatchObject({ error: { code: 'PESDATA_SYNC_LEASE_LOST' } });
  });

  it('creates the queued platform run and its concrete audit record atomically', async () => {
    const client = { listPlayers: async () => ({ list: [], count: 0 }), getPlayerDetail: async (id: string) => detail(id) };
    const sync = new PesdataSyncService(prisma, importService, client as never, {}, new AuditLogService(prisma));

    const queued = await sync.createPlatformRun(adminId, { mode: 'full' });

    await expect(prisma.auditLog.findFirst({ where: { actorAdminId: adminId, resourceId: queued.runId } }))
      .resolves.toMatchObject({ action: 'START_PLAYER_CARD_FULL_SYNC', resourceType: 'ExternalSyncRun' });
  });

  it('does not reserve a platform lease when the start audit cannot be written', async () => {
    const client = { listPlayers: async () => ({ list: [], count: 0 }), getPlayerDetail: async (id: string) => detail(id) };
    const audit = { record: async () => { throw new Error('audit unavailable'); } };
    const sync = new PesdataSyncService(prisma, importService, client as never, {}, audit as never);

    await expect(sync.createPlatformRun(adminId, { mode: 'full' })).rejects.toThrow('audit unavailable');

    await expect(prisma.externalSyncRun.count({ where: { actorId: adminId } })).resolves.toBe(0);
  });

  it('allows only one worker to claim a queued platform run', async () => {
    let listCalls = 0;
    const client = {
      listPlayers: async () => {
        listCalls += 1;
        return { list: [], count: 0 };
      },
      getPlayerDetail: async (id: string) => detail(id)
    };
    const sync = new PesdataSyncService(prisma, importService, client as never);
    const queued = await sync.createPlatformRun(adminId, { mode: 'incremental' });

    const outcomes = await Promise.allSettled([
      sync.executePlatformRun(queued.runId),
      sync.executePlatformRun(queued.runId)
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(listCalls).toBe(1);
  });

  it('fences an expired worker before it can persist details or overwrite reconciliation', async () => {
    let releaseDetail!: () => void;
    let detailStarted!: () => void;
    const started = new Promise<void>((resolve) => { detailStarted = resolve; });
    const client = {
      listPlayers: async () => ({ list: [summary(990)], count: 1 }),
      getPlayerDetail: async (id: string) => {
        detailStarted();
        await new Promise<void>((resolve) => { releaseDetail = resolve; });
        return detail(id);
      }
    };
    const sync = new PesdataSyncService(prisma, importService, client as never, { pageSize: 1 });
    const queued = await sync.createPlatformRun(adminId, { mode: 'sample', limit: 1 });
    const execution = sync.executePlatformRun(queued.runId);
    await started;
    await prisma.externalSyncRun.update({
      where: { id: queued.runId },
      data: {
        status: 'FAILED',
        activeLeaseKey: null,
        leaseOwnerToken: null,
        currentPhase: 'INTERRUPTED',
        errorCode: 'PROCESS_INTERRUPTED'
      }
    });
    releaseDetail();

    await expect(execution).rejects.toMatchObject({ code: 'PESDATA_SYNC_LEASE_LOST' });
    await expect(prisma.externalSyncItem.count({ where: { runId: queued.runId } })).resolves.toBe(0);
    await expect(prisma.externalSyncRun.findUniqueOrThrow({ where: { id: queued.runId } }))
      .resolves.toMatchObject({ status: 'FAILED', errorCode: 'PROCESS_INTERRUPTED', leaseOwnerToken: null });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.adminAccount.delete({ where: { id: adminId } });
    await prisma.$disconnect();
  });

  it('paginates a sample, stores items, and creates one ready import batch', async () => {
    const listOffsets: number[] = [];
    const detailIds: string[] = [];
    const client = {
      listPlayers: async ({ start }: { start: number }) => {
        listOffsets.push(start);
        return { list: [summary(start + 1)], count: 10 };
      },
      getPlayerDetail: async (id: string) => {
        detailIds.push(id);
        return detail(id);
      }
    };
    const service = new PesdataSyncService(prisma, importService, client as never, { pageSize: 1 });

    const result = await service.start(actorId, { mode: 'sample', limit: 3 });

    expect(listOffsets).toEqual([0, 1, 2]);
    expect(detailIds).toEqual(['1', '2', '3']);
    expect(result).toMatchObject({ status: 'READY', scannedCount: 3, fetchedCount: 3, failedCount: 0 });
    expect(result.batchIds).toHaveLength(1);
    await expect(prisma.externalSyncItem.count({ where: { runId: result.runId ?? '' } })).resolves.toBe(3);
    await expect(prisma.importBatch.findUnique({ where: { id: result.batchIds[0]! } }))
      .resolves.toMatchObject({ status: 'READY', totalCount: 3 });
  });

  it('uses monotonic offsets and stops on a short page even when count changes', async () => {
    const offsets: number[] = [];
    const pages = new Map([
      [0, { list: [summary(1), summary(2)], count: 10 }],
      [2, { list: [summary(3)], count: 3 }]
    ]);
    const client = {
      listPlayers: async ({ start }: { start: number }) => {
        offsets.push(start);
        return pages.get(start) ?? { list: [], count: 3 };
      },
      getPlayerDetail: async (id: string) => detail(id)
    };
    const service = new PesdataSyncService(prisma, importService, client as never, { pageSize: 2 });

    const result = await service.start(actorId, { mode: 'full', dryRun: true });

    expect(offsets).toEqual([0, 2]);
    expect(result).toMatchObject({ runId: null, status: 'READY', scannedCount: 3, fetchedCount: 3 });
    await expect(prisma.externalSyncRun.count({ where: { actorId } })).resolves.toBe(0);
  });

  it('rejects a second active synchronization for the same source', async () => {
    const source = await prisma.dataSource.findUniqueOrThrow({ where: { code: 'pesdata' } });
    await prisma.externalSyncRun.create({
      data: {
        sourceId: source.id,
        actorId,
        mode: 'FULL',
        status: 'RUNNING',
        activeLeaseKey: 'pesdata'
      }
    });
    const client = {
      listPlayers: async () => ({ list: [], count: 0 }),
      getPlayerDetail: async (id: string) => detail(id)
    };

    await expect(
      new PesdataSyncService(prisma, importService, client as never).start(actorId, { mode: 'full' })
    ).rejects.toMatchObject({ code: 'PESDATA_SYNC_CONFLICT' });
  });

  it('splits deterministic chunks and reuses idempotent batch outcomes', async () => {
    const calls: Array<{ fileName: string; content: string }> = [];
    const batches = new Map<string, string>();
    const fakeImport = {
      createBatchWithOutcome: async (_actorId: string, input: { fileName: string; content: string }) => {
        calls.push(input);
        const id = batches.get(input.content) ?? `batch-${batches.size + 1}`;
        batches.set(input.content, id);
        return { batch: { id }, created: !batches.has(input.content) };
      }
    };
    const service = new PesdataSyncService({} as never, fakeImport as never, {} as never);
    const runId = '11111111-1111-4111-8111-111111111111';
    const rows = Array.from({ length: 5_001 }, (_, index) => ({
      externalId: String(5_001 - index),
      playerNameEn: `Player ${index}`
    }));

    const first = await service.createImportBatches(actorId, runId, rows, false);
    const second = await service.createImportBatches(actorId, runId, rows, false);

    expect(first).toEqual(['batch-1', 'batch-2']);
    expect(second).toEqual(first);
    expect(calls.map(({ fileName }) => fileName)).toEqual([
      `pesdata-${runId}-001.json`,
      `pesdata-${runId}-002.json`,
      `pesdata-${runId}-001.json`,
      `pesdata-${runId}-002.json`
    ]);
    expect(JSON.parse(calls[0]!.content)).toHaveLength(5_000);
    expect(JSON.parse(calls[1]!.content)).toHaveLength(1);
    expect(JSON.parse(calls[0]!.content)[0].externalId).toBe('1');
  });

  it('skips unchanged summaries and fetches changed and new players incrementally', async () => {
    const initialClient = {
      listPlayers: async () => ({ list: [summary(1), summary(2)], count: 2 }),
      getPlayerDetail: async (id: string) => detail(id)
    };
    await new PesdataSyncService(prisma, importService, initialClient as never, { pageSize: 10 })
      .start(actorId, { mode: 'full' });

    const changed = { ...summary(2), overall: 91 };
    const detailIds: string[] = [];
    const incrementalClient = {
      listPlayers: async () => ({ list: [summary(1), changed, summary(3)], count: 3 }),
      getPlayerDetail: async (id: string) => {
        detailIds.push(id);
        return { ...detail(id), ...(id === '2' ? { overall: 91 } : {}) };
      }
    };
    const result = await new PesdataSyncService(
      prisma,
      importService,
      incrementalClient as never,
      { pageSize: 10 }
    ).start(actorId, { mode: 'incremental' });

    expect(detailIds).toEqual(['2', '3']);
    expect(result).toMatchObject({ scannedCount: 3, skippedCount: 1, fetchedCount: 2, failedCount: 0 });
    const items = await prisma.externalSyncItem.findMany({ where: { runId: result.runId! } });
    expect(items.map(({ externalId, status }) => [externalId, status]).sort()).toEqual([
      ['1', 'SKIPPED'],
      ['2', 'FETCHED'],
      ['3', 'FETCHED']
    ]);
  });

  it('removes a newly created unlinked batch when ownership is lost before linking', async () => {
    const source = await prisma.dataSource.findUniqueOrThrow({ where: { code: 'pesdata' } });
    const leaseOwnerToken = randomUUID();
    const run = await prisma.externalSyncRun.create({ data: {
      sourceId: source.id,
      actorId: adminId,
      mode: 'INCREMENTAL',
      status: 'RUNNING',
      activeLeaseKey: 'pesdata',
      leaseOwnerToken,
      currentPhase: 'IMPORTING',
      leaseExpiresAt: new Date(Date.now() + 60_000)
    } });
    const losingImport = {
      createBatchForPlatformAdmin: async (actor: string, input: Parameters<PlayerImportService['createBatchForPlatformAdmin']>[1]) => {
        const outcome = await importService.createBatchForPlatformAdmin(actor, input);
        await prisma.externalSyncRun.update({ where: { id: run.id }, data: {
          status: 'FAILED', activeLeaseKey: null, leaseOwnerToken: null, leaseExpiresAt: null
        } });
        return outcome;
      }
    };
    const service = new PesdataSyncService(prisma, losingImport as never, {} as never);

    await expect(service.createImportBatches(
      adminId,
      run.id,
      [mapPesdataPlayer(detail('991001'))],
      true,
      true,
      leaseOwnerToken
    )).rejects.toMatchObject({ code: 'PESDATA_SYNC_LEASE_LOST' });

    await expect(prisma.importBatch.count({ where: {
      createdBy: adminId,
      fileName: `pesdata-${run.id}-001.json`
    } })).resolves.toBe(0);
  });

  it('resumes at the checkpoint without refetching successful details', async () => {
    const firstDetailIds: string[] = [];
    const failingClient = {
      listPlayers: async ({ start }: { start: number }) => {
        if (start === 0) return { list: [summary(1)], count: 2 };
        throw new PesdataClientError('PESDATA_PROTOCOL_ERROR', 'changed protocol', 'list', 403, 1);
      },
      getPlayerDetail: async (id: string) => {
        firstDetailIds.push(id);
        return detail(id);
      }
    };
    const firstService = new PesdataSyncService(prisma, importService, failingClient as never, { pageSize: 1 });
    const failedRunId = await (async () => {
      try {
        await firstService.start(actorId, { mode: 'full' });
        throw new Error('expected synchronization to fail');
      } catch (error) {
        expect(error).toMatchObject({ code: 'PESDATA_PROTOCOL_ERROR' });
        const failed = await prisma.externalSyncRun.findFirstOrThrow({
          where: { actorId, status: 'FAILED' },
          orderBy: { createdAt: 'desc' }
        });
        expect(failed.activeLeaseKey).toBeNull();
        expect(failed.currentOffset).toBe(1);
        return failed.id;
      }
    })();

    const resumedDetailIds: string[] = [];
    const resumedClient = {
      listPlayers: async ({ start }: { start: number }) => ({
        list: start === 1 ? [summary(2)] : [],
        count: 2
      }),
      getPlayerDetail: async (id: string) => {
        resumedDetailIds.push(id);
        return detail(id);
      }
    };
    const result = await new PesdataSyncService(
      prisma,
      importService,
      resumedClient as never,
      { pageSize: 1 }
    ).resume(actorId, failedRunId);

    expect(firstDetailIds).toEqual(['1']);
    expect(resumedDetailIds).toEqual(['2']);
    expect(result).toMatchObject({ status: 'READY', scannedCount: 2, fetchedCount: 2 });
  });

  it('releases the lease when retrying a failed item hits a protocol error', async () => {
    const source = await prisma.dataSource.findUniqueOrThrow({ where: { code: 'pesdata' } });
    const run = await prisma.externalSyncRun.create({
      data: {
        sourceId: source.id,
        actorId,
        mode: 'FULL',
        status: 'FAILED',
        currentOffset: 1,
        items: {
          create: {
            externalId: '1',
            summaryChecksum: 'a'.repeat(64),
            status: 'FAILED',
            attempts: 1
          }
        }
      }
    });
    const client = {
      listPlayers: async () => ({ list: [], count: 1 }),
      getPlayerDetail: async () => {
        throw new PesdataClientError('PESDATA_PROTOCOL_ERROR', 'changed protocol', 'detail', 403, 1);
      }
    };

    await expect(
      new PesdataSyncService(prisma, importService, client as never).resume(actorId, run.id)
    ).rejects.toMatchObject({ code: 'PESDATA_PROTOCOL_ERROR' });

    await expect(prisma.externalSyncRun.findUniqueOrThrow({ where: { id: run.id } }))
      .resolves.toMatchObject({ status: 'FAILED', activeLeaseKey: null });
  });

  it('keeps successful items when another detail cannot be mapped', async () => {
    const client = {
      listPlayers: async () => ({ list: [summary(1), summary(2)], count: 2 }),
      getPlayerDetail: async (id: string) => id === '1' ? detail(id) : { ...detail(id), agentTitle: '' }
    };
    const result = await new PesdataSyncService(prisma, importService, client as never, { pageSize: 10 })
      .start(actorId, { mode: 'full' });

    expect(result).toMatchObject({ status: 'READY', fetchedCount: 1, failedCount: 1 });
    expect(result.batchIds).toHaveLength(1);
    await expect(prisma.importBatch.findUnique({ where: { id: result.batchIds[0]! } }))
      .resolves.toMatchObject({ totalCount: 1 });
  });

  it('retries a previously failed item during the next incremental run', async () => {
    const initialClient = {
      listPlayers: async () => ({ list: [summary(1), summary(2)], count: 2 }),
      getPlayerDetail: async (id: string) => id === '2' ? { ...detail(id), agentTitle: '' } : detail(id)
    };
    await new PesdataSyncService(prisma, importService, initialClient as never, { pageSize: 10 })
      .start(actorId, { mode: 'full' });

    const retried: string[] = [];
    const incrementalClient = {
      listPlayers: async () => ({ list: [summary(1), summary(2)], count: 2 }),
      getPlayerDetail: async (id: string) => {
        retried.push(id);
        return detail(id);
      }
    };
    const result = await new PesdataSyncService(
      prisma,
      importService,
      incrementalClient as never,
      { pageSize: 10 }
    ).start(actorId, { mode: 'incremental' });

    expect(retried).toEqual(['2']);
    expect(result).toMatchObject({ skippedCount: 1, fetchedCount: 1, failedCount: 0 });
  });

  it('does not synthesize inactive cards when a source item disappears', async () => {
    const initialClient = {
      listPlayers: async () => ({ list: [summary(1), summary(2)], count: 2 }),
      getPlayerDetail: async (id: string) => detail(id)
    };
    await new PesdataSyncService(prisma, importService, initialClient as never, { pageSize: 10 })
      .start(actorId, { mode: 'full' });

    const incrementalClient = {
      listPlayers: async () => ({ list: [summary(1)], count: 1 }),
      getPlayerDetail: async (id: string) => detail(id)
    };
    const result = await new PesdataSyncService(
      prisma,
      importService,
      incrementalClient as never,
      { pageSize: 10 }
    ).start(actorId, { mode: 'incremental' });
    const records = await prisma.importRecord.findMany({ where: { batchId: result.batchIds[0]! } });

    expect(records).toHaveLength(1);
    expect(records.some(({ normalizedJson }) =>
      typeof normalizedJson === 'object' && normalizedJson !== null &&
      'status' in normalizedJson && normalizedJson.status === 'INACTIVE'
    )).toBe(false);
  });
});
