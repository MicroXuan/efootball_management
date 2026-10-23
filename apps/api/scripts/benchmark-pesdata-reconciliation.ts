import { randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../src/database/prisma.service.js';
import { PlayerCatalogScanRepository } from '../src/pesdata-sync/player-catalog-scan.repository.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set DATABASE_URL explicitly to an isolated local test/verify database');
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1'].includes(target.hostname)
  || !/(test|verify)/i.test(target.pathname.slice(1))) {
  throw new Error('Benchmark may run only on a local test/verify database');
}

const total = 50_000;
const pageSize = 100;
const token = randomUUID();
const backupPath = `/tmp/efm-reconciliation-benchmark-${token}.ndjson`;
const prisma = new PrismaService();
let runId: string | null = null;
let sourceId: string | null = null;
let actorId: string | null = null;

async function backup(): Promise<void> {
  if (!runId) return;
  const run = await prisma.externalSyncRun.findUniqueOrThrow({ where: { id: runId } });
  const pages = await prisma.playerCatalogScanPage.findMany({ where: { runId } });
  writeFileSync(backupPath, `${JSON.stringify({ kind: 'run', data: run })}\n`);
  for (const page of pages) appendFileSync(backupPath, `${JSON.stringify({ kind: 'page', data: page })}\n`);
  for (const pass of [1, 2]) {
    let cursor = '';
    for (;;) {
      const entries = await prisma.playerCatalogScanEntry.findMany({
        where: { runId, pass, externalId: { gt: cursor } },
        orderBy: { externalId: 'asc' }, take: 1000
      });
      if (!entries.length) break;
      for (const entry of entries) appendFileSync(backupPath, `${JSON.stringify({ kind: 'entry', data: entry })}\n`);
      cursor = entries[entries.length - 1]!.externalId;
    }
  }
}

async function main(): Promise<void> {
  await prisma.$connect();
  const actor = await prisma.adminAccount.create({ data: {
    username: `reconciliation-benchmark-${token}`, displayName: 'Benchmark',
    passwordHash: 'unused', platformRole: 'PLATFORM_ADMIN'
  } });
  actorId = actor.id;
  const source = await prisma.dataSource.create({ data: {
    code: `test-reconciliation-${token}`, name: 'Synthetic reconciliation benchmark', type: 'API'
  } });
  sourceId = source.id;
  const run = await prisma.externalSyncRun.create({ data: {
    sourceId, actorId, mode: 'RECONCILE', status: 'READY', chunkSize: pageSize,
    businessDate: new Date('2026-10-23T00:00:00Z')
  } });
  runId = run.id;
  const scans = new PlayerCatalogScanRepository(prisma);
  const passMs: number[] = [];
  let peakHeapBytes = process.memoryUsage().heapUsed;
  for (const pass of [1, 2] as const) {
    const started = performance.now();
    for (let offset = 0; offset < total; offset += pageSize) {
      const summaries = Array.from({ length: pageSize }, (_, index) => ({
        playerId: `bench-${String(offset + index).padStart(6, '0')}`,
        playerName: `Benchmark ${offset + index}`
      }));
      await scans.recordPage(runId, pass, offset, pageSize, total, summaries);
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    }
    passMs.push(performance.now() - started);
  }
  const verificationStart = performance.now();
  const verified = await scans.verify(runId);
  const verificationMs = performance.now() - verificationStart;
  if (!verified.trusted || verified.sourceTotal !== total) throw new Error('Synthetic scan was not trusted');
  const preview = {
    runId, sourceId, actorId,
    pages: await prisma.playerCatalogScanPage.count({ where: { runId } }),
    entries: await prisma.playerCatalogScanEntry.count({ where: { runId } })
  };
  process.stdout.write(`${JSON.stringify({ total, pageSize, passMs, verificationMs,
    peakHeapMiB: peakHeapBytes / 1024 / 1024, preview, backupPath })}\n`);
}

try {
  await main();
} finally {
  if (runId) {
    const before = await prisma.playerCatalogScanEntry.count({ where: { runId } });
    await backup();
    await prisma.$transaction(async (tx) => {
      await tx.externalSyncRun.delete({ where: { id: runId! } });
      if (sourceId) await tx.dataSource.delete({ where: { id: sourceId } });
      if (actorId) await tx.adminAccount.delete({ where: { id: actorId } });
    }, { timeout: 120_000 });
    const after = await prisma.playerCatalogScanEntry.count({ where: { runId } });
    process.stdout.write(`${JSON.stringify({ cleanup: { runId, entriesBefore: before, entriesAfter: after,
      backupPath } })}\n`);
  } else {
    if (sourceId) await prisma.dataSource.delete({ where: { id: sourceId } });
    if (actorId) await prisma.adminAccount.delete({ where: { id: actorId } });
  }
  await prisma.$disconnect();
}
