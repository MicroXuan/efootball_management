import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../src/database/prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const target = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)
  || !/(test|verify)/i.test(target.pathname.slice(1))) {
  throw new Error('Benchmark requires an explicit local test/verify database');
}

const prisma = new PrismaService();
const runId = randomUUID();
const ids = Array.from({ length: 50_000 }, () => randomUUID());
const backupPath = `/tmp/player-market-search-benchmark-${runId}.json`;
const chunks = <T>(items: T[], size: number) => Array.from(
  { length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size)
);
const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round((sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0) * 10) / 10;
};

async function timed(label: string, call: () => Promise<unknown>): Promise<void> {
  const samples: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const start = performance.now();
    await call();
    samples.push(performance.now() - start);
  }
  console.log(JSON.stringify({ label, p50Ms: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) }));
}

async function main(): Promise<void> {
  console.log(JSON.stringify({ target: `${target.hostname}:${target.port}/${target.pathname.slice(1)}`, players: ids.length, runId }));
  await writeFile(backupPath, JSON.stringify({ runId, ids }));
  await prisma.$connect();
  try {
    for (const [batch, batchIds] of chunks(ids, 500).entries()) {
      await prisma.footballPlayer.createMany({ data: batchIds.map((id, index) => ({
        id, nameEn: `Market Benchmark Player ${batch * 500 + index}`,
        clubEn: 'Benchmark Club', publishedAt: new Date()
      })) });
    }
    const where = (keyword?: string) => ({
      publishedAt: { not: null },
      ...(keyword ? { OR: [
        { nameZh: { contains: keyword } }, { nameEn: { contains: keyword } },
        { shortName: { contains: keyword } }, { club: { contains: keyword } },
        { clubZh: { contains: keyword } }, { clubEn: { contains: keyword } }
      ] } : {})
    });
    const page = (keyword?: string) => prisma.footballPlayer.findMany({
      where: where(keyword), select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 31
    });
    await timed('market-default-first-page', () => page());
    await timed('market-common-keyword', () => page('Benchmark'));
    await timed('market-rare-keyword', () => page('Player 49999'));
    const explain = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN SELECT id FROM football_players
      WHERE published_at IS NOT NULL AND name_en LIKE '%Player 49999%'
      ORDER BY created_at ASC, id ASC LIMIT 31
    `;
    console.log(JSON.stringify({ explain }, (_key, value: unknown) => typeof value === 'bigint' ? Number(value) : value));
  } finally {
    console.log(JSON.stringify({ cleanupTarget: runId, exactPlayers: await prisma.footballPlayer.count({ where: { id: { in: ids } } }), backupPath }));
    for (const batchIds of chunks(ids, 500)) {
      await prisma.$transaction((tx) => tx.footballPlayer.deleteMany({ where: { id: { in: batchIds } } }));
    }
    console.log(JSON.stringify({ cleanupVerified: (await prisma.footballPlayer.count({ where: { id: { in: ids } } })) === 0 }));
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
