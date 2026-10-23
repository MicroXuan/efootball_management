import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../src/database/prisma.service.js';
import { PlayerCatalogService } from '../src/player-catalog/player-catalog.service.js';
import { PlayerCatalogReadRepository } from '../src/player-catalog/player-catalog-read.repository.js';
import { encodePlayerSearchCursor } from '../src/player-catalog/player-search-cursor.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const target = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)
  || !/(test|verify)/i.test(target.pathname.slice(1))) {
  throw new Error('Benchmark requires an explicit local test/verify database');
}
const arg = (key: string, fallback: number): number => {
  const raw = process.argv.find((value) => value.startsWith(`--${key}=`))?.split('=')[1];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid --${key}`);
  return value;
};
const count = arg('count', 50_000);
const versionsPerCard = arg('versions-per-card', 2);
const seed = arg('seed', 1);
if (count > 100_000 || versionsPerCard > 4) throw new Error('Benchmark size is too large');
const prisma = new PrismaService();
const catalog = new PlayerCatalogService(prisma, new PlayerCatalogReadRepository(prisma));
const sourceId = randomUUID();
const actorId = randomUUID();
const batchIds: string[] = [];
const releaseSequences: number[] = [];
const playerIds: string[] = [];
const packIds: string[] = [];
const cardIds: string[] = [];
const chunk = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const percentile = (values: number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0) * 10) / 10;
};

async function cleanup(): Promise<void> {
  const exact = await prisma.playerCard.count({ where: { sourceId } });
  const backupPath = `/tmp/player-catalog-benchmark-${sourceId}.json`;
  await writeFile(backupPath, JSON.stringify({ sourceId, actorId, batchIds, releaseSequences, playerIds, packIds, cardIds }));
  console.log(JSON.stringify({ cleanupTarget: sourceId, exactCards: exact, backupPath }));
  for (const ids of chunk(cardIds, 500)) {
    await prisma.$transaction(async (tx) => {
      await tx.playerCardVersion.deleteMany({ where: { playerCardId: { in: ids } } });
      await tx.playerCard.deleteMany({ where: { id: { in: ids }, sourceId } });
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.catalogRelease.deleteMany({ where: { sequence: { in: releaseSequences } } });
    await tx.importBatch.deleteMany({ where: { id: { in: batchIds }, sourceId } });
    await tx.cardPack.deleteMany({ where: { id: { in: packIds }, sourceId } });
    await tx.footballPlayer.deleteMany({ where: { id: { in: playerIds } } });
    await tx.dataSource.deleteMany({ where: { id: sourceId } });
    await tx.user.deleteMany({ where: { id: actorId } });
  });
  console.log(JSON.stringify({ cleanupVerified: (await prisma.playerCard.count({ where: { sourceId } })) === 0 }));
}

async function timed(label: string, call: () => Promise<unknown>): Promise<void> {
  const samples: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const started = performance.now();
    await call();
    samples.push(performance.now() - started);
  }
  console.log(JSON.stringify({ label, p50Ms: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) }));
}

async function main(): Promise<void> {
  console.log(JSON.stringify({ target: `${target.hostname}:${target.port}/${target.pathname.slice(1)}`, count, versionsPerCard, seed }));
  await prisma.$connect();
  let initialized = false;
  try {
    await prisma.user.create({ data: { id: actorId, wechatOpenId: `catalog-benchmark-${actorId}`, displayName: 'Catalog benchmark' } });
    initialized = true;
    await prisma.dataSource.create({ data: { id: sourceId, code: `catalog-benchmark-${sourceId}`, name: 'Catalog benchmark' } });
    for (let index = 0; index < Math.ceil(count / 100); index += 1) playerIds.push(randomUUID());
    for (let index = 0; index < Math.ceil(count / 100); index += 1) packIds.push(randomUUID());
    await prisma.footballPlayer.createMany({ data: playerIds.map((id, index) => ({ id, nameEn: `Benchmark Player ${index}` })) });
    await prisma.cardPack.createMany({ data: packIds.map((id, index) => ({ id, sourceId, externalId: `pack-${index}`, nameEn: `Benchmark Pack ${index}` })) });
    for (let version = 0; version < versionsPerCard; version += 1) {
      const batchId = randomUUID();
      batchIds.push(batchId);
      await prisma.importBatch.create({ data: {
        id: batchId, sourceId, fileName: `benchmark-${version}.json`, format: 'JSON',
        checksum: createHash('sha256').update(`${sourceId}-${version}`).digest('hex'), createdBy: actorId
      } });
      const release = await prisma.catalogRelease.create({ data: {
        batchId, publishedBy: actorId, createdCount: version === 0 ? count : 0,
        updatedCount: version === 0 ? 0 : count, unchangedCount: 0
      } });
      releaseSequences.push(release.sequence);
    }
    for (let start = 0; start < count; start += 500) {
      const end = Math.min(start + 500, count);
      const rows = Array.from({ length: end - start }, (_, offset) => {
        const index = start + offset;
        const id = randomUUID();
        cardIds.push(id);
        return { id, sourceId, externalId: `card-${seed}-${index}`, playerId: playerIds[Math.floor(index / 100)]!,
          cardPackId: packIds[Math.floor(index / 100)]!, cardName: `Benchmark Card ${index}`,
          position: 'CMF' as const, overallRating: 70 + ((index + seed) % 40), cardType: 'STANDARD' as const };
      });
      await prisma.playerCard.createMany({ data: rows });
      for (let version = 0; version < versionsPerCard; version += 1) {
        await prisma.playerCardVersion.createMany({ data: rows.map((row, offset) => ({
          playerCardId: row.id, releaseSequence: releaseSequences[version]!, playerId: row.playerId,
          playerNameEn: `Benchmark Player ${Math.floor((start + offset) / 100)}`,
          normalizedNameEn: `benchmark player ${Math.floor((start + offset) / 100)}`,
          cardPackId: row.cardPackId, packNameEn: `Benchmark Pack ${Math.floor((start + offset) / 100)}`,
          normalizedPackNameEn: `benchmark pack ${Math.floor((start + offset) / 100)}`,
          cardName: row.cardName, normalizedCardName: row.cardName.toLowerCase(),
          packReleaseDate: new Date(Date.UTC(2026, 0, 1 + ((start + offset) % 300))),
          position: row.position, overallRating: row.overallRating, cardType: row.cardType,
          status: 'ACTIVE', skillsJson: [], attributesJson: {},
          publishedAt: new Date(Date.UTC(2026, 9, 20 + version))
        })) });
      }
      if (end % 5000 === 0) console.log(JSON.stringify({ inserted: end }));
    }
    const first = await catalog.search({ limit: 20 });
    const deepAnchor = await prisma.playerCardVersion.findFirst({
      where: { releaseSequence: releaseSequences.at(-1)! },
      orderBy: [{ packReleaseDate: 'desc' }, { overallRating: 'desc' }, { publishedAt: 'desc' }, { playerCardId: 'asc' }],
      skip: Math.floor(count * 0.8),
      take: 1
    });
    const deepCursor = deepAnchor ? encodePlayerSearchCursor({
      version: 2, releaseSequence: releaseSequences.at(-1)!,
      packReleaseDate: deepAnchor.packReleaseDate?.toISOString().slice(0, 10) ?? null,
      overallRating: deepAnchor.overallRating, publishedAt: deepAnchor.publishedAt.toISOString(), id: deepAnchor.playerCardId
    }) : null;
    await timed('first-page', async () => catalog.search({ limit: 20 }));
    await timed('next-page', async () => catalog.search({ limit: 20, cursor: first.nextCursor! }));
    if (deepCursor) await timed('deep-page', async () => catalog.search({ limit: 20, cursor: deepCursor }));
    await timed('filter', async () => catalog.search({ limit: 20, minOverall: 95, position: 'CMF' }));
    await timed('search', async () => catalog.search({ limit: 20, keyword: 'benchmark card 499' }));
    await timed('card-detail', async () => catalog.getCard(cardIds[0]!));
    await timed('pack-list', async () => catalog.listPacks({ limit: 20 }));
    await timed('pack-options', async () => catalog.listPackOptions());
    const explain = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      EXPLAIN SELECT v.id FROM player_card_versions v
      WHERE v.release_sequence <= ${releaseSequences.at(-1)!} AND v.status = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM player_card_versions newer
          WHERE newer.player_card_id = v.player_card_id
            AND newer.release_sequence <= ${releaseSequences.at(-1)!}
            AND newer.release_sequence > v.release_sequence)
      ORDER BY v.pack_release_date DESC,
        v.overall_rating DESC, v.published_at DESC, v.player_card_id ASC LIMIT 21
    `;
    console.log(JSON.stringify({ explain }, (_key, value: unknown) => typeof value === 'bigint' ? Number(value) : value));
  } finally {
    if (initialized) await cleanup();
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
