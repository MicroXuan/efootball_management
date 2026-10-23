import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerImportPublisher } from '../player-import/player-import.publisher.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import { decodeCatalogCursor, encodeCatalogCursor } from './catalog-cursor.js';
import { PlayerCatalogService } from './player-catalog.service.js';
import { PlayerCatalogReadRepository } from './player-catalog-read.repository.js';

config({ path: '../../.env', quiet: true });

describe('catalog cursor', () => {
  it('round-trips a validated opaque cursor', () => {
    const value = {
      releaseSequence: 7,
      publishedAt: '2026-09-24T12:00:00.000Z',
      overallRating: 97,
      id: '11111111-1111-4111-8111-111111111111'
    };
    expect(decodeCatalogCursor(encodeCatalogCursor(value))).toEqual(value);
  });

  it('rejects malformed cursor values with a stable code', () => {
    let thrown: unknown;
    try {
      decodeCatalogCursor('not-a-cursor');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ response: { code: 'INVALID_CURSOR' } });
  });
});

describe('PlayerCatalogService', () => {
  const prisma = new PrismaService();
  const authorization = { can: async () => true };
  const importer = new PlayerImportService(prisma, authorization as never);
  const publisher = new PlayerImportPublisher(
    prisma,
    authorization as never
  );
  const catalog = new PlayerCatalogService(prisma, new PlayerCatalogReadRepository(prisma));
  const actorId = randomUUID();
  let sourceId: string;
  let sourceCode: string;

  const card = (index: number, overrides: Record<string, unknown> = {}) => ({
    externalId: `catalog-${index}`,
    playerExternalId: `catalog-player-${index}`,
    playerNameEn: `${sourceCode} Player ${index}`,
    cardName: `Card ${index}`,
    position: index % 2 === 0 ? 'CMF' : 'RWF',
    overallRating: 70 + index,
    cardType: index % 2 === 0 ? 'FEATURED' : 'STANDARD',
    status: 'ACTIVE',
    packExternalId: 'catalog-pack',
    packName: 'Catalog Pack',
    skills: ['Passing'],
    attributes: { passing: 80 + index },
    ...overrides
  });

  const importAndPublish = async (rows: unknown[]) => {
    const batch = await importer.createBatch(actorId, {
      sourceCode,
      fileName: `${randomUUID()}.json`,
      format: 'JSON',
      content: JSON.stringify(rows)
    });
    return publisher.publish(actorId, batch.id);
  };

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: { id: actorId, wechatOpenId: `catalog-test-${actorId}`, displayName: '目录测试员' }
    });
  });

  beforeEach(async () => {
    sourceId = '';
    sourceCode = `catalog-${randomUUID()}`;
    sourceId = (await prisma.dataSource.create({ data: { code: sourceCode, name: 'Catalog test' } })).id;
  });

  afterEach(async () => {
    if (!sourceId) return;
    const cards = await prisma.playerCard.findMany({ where: { sourceId }, select: { id: true, playerId: true } });
    const cardIds = cards.map(({ id }) => id);
    const playerIds = [...new Set(cards.map(({ playerId }) => playerId))];
    if (cardIds.length) await prisma.footballPlayerBestCard.deleteMany({ where: { playerCardId: { in: cardIds } } });
    if (cardIds.length) await prisma.playerCardAutoBuild.deleteMany({ where: { playerCardId: { in: cardIds } } });
    if (cardIds.length) await prisma.playerCardVersion.deleteMany({ where: { playerCardId: { in: cardIds } } });
    await prisma.catalogRelease.deleteMany({ where: { batch: { sourceId } } });
    await prisma.importBatch.deleteMany({ where: { sourceId } });
    await prisma.playerCard.deleteMany({ where: { sourceId } });
    await prisma.cardPack.deleteMany({ where: { sourceId } });
    await prisma.footballPlayerSource.deleteMany({ where: { sourceId } });
    if (playerIds.length) await prisma.footballPlayer.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.dataSource.delete({ where: { id: sourceId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('filters, normalizes Unicode keywords, and excludes inactive and unpublished cards', async () => {
    await importAndPublish([
      card(1, {
        playerNameEn: `Ａｌｅｘｉｓ ${sourceCode}`,
        overallRating: 97,
        position: 'AMF',
        cardType: 'FEATURED'
      }),
      card(2, { status: 'INACTIVE' })
    ]);
    const unpublishedPlayer = await prisma.footballPlayer.create({ data: { nameEn: 'Unpublished' } });
    await prisma.playerCard.create({
      data: {
        sourceId,
        externalId: 'unpublished',
        playerId: unpublishedPlayer.id,
        cardName: 'Hidden',
        position: 'AMF',
        overallRating: 100,
        cardType: 'FEATURED'
      }
    });

    const result = await catalog.search({
      keyword: `Alexis ${sourceCode}`,
      position: 'AMF',
      minOverall: 95,
      cardType: 'FEATURED',
      limit: 20
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.playerNameEn).toBe(`Ａｌｅｘｉｓ ${sourceCode}`);
    expect(result.items.every((item) => item.id !== 'unpublished')).toBe(true);
  });

  it('keeps all original IDs stable across pages after a later release', async () => {
    await importAndPublish(Array.from({ length: 25 }, (_, index) => card(index + 1)));
    const firstPage = await catalog.search({ keyword: sourceCode, limit: 10 });
    expect(firstPage.items).toHaveLength(10);
    expect(firstPage.nextCursor).not.toBeNull();

    await importAndPublish([
      card(15, { overallRating: 109 }),
      card(26, { overallRating: 110 })
    ]);

    const seen = [...firstPage.items.map(({ id }) => id)];
    let cursor = firstPage.nextCursor;
    while (cursor) {
      const page = await catalog.search({ keyword: sourceCode, cursor, limit: 10 });
      expect(page.releaseSequence).toBe(firstPage.releaseSequence);
      seen.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    const latest = await catalog.search({ keyword: sourceCode, limit: 100 });
    expect(latest.items).toHaveLength(26);
    expect(latest.items[0]?.overallRating).toBe(110);
  });

  it('orders dated packs before undated packs and then by rating', async () => {
    await importAndPublish([
      card(1, { packExternalId: 'early', packName: 'Early', releaseDate: '2026-01-01', overallRating: 99 }),
      card(2, { packExternalId: 'late', packName: 'Late', releaseDate: '2026-10-20', overallRating: 80 }),
      card(3, { packExternalId: 'late', packName: 'Late', releaseDate: '2026-10-20', overallRating: 90 }),
      card(4, { packExternalId: 'undated', packName: 'Undated', overallRating: 110 })
    ]);
    const first = await catalog.search({ keyword: sourceCode, limit: 2 });
    const second = await catalog.search({ keyword: sourceCode, limit: 2, cursor: first.nextCursor! });
    expect([...first.items, ...second.items].map((item) => item.overallRating)).toEqual([90, 80, 99, 110]);
  });

  it('treats search wildcards as literal text and keeps fields separate', async () => {
    await importAndPublish([
      card(1, { cardName: 'Cafe\u0301 100%_\\', packExternalId: 'literal', packName: 'Special Pack' }),
      card(2, { cardName: 'Alpha', packExternalId: 'split', packName: 'Beta' })
    ]);
    for (const keyword of ['CAFÉ', '100%', '%_', '_\\']) {
      const result = await catalog.search({ keyword, limit: 20 });
      expect(result.items.map((item) => item.cardName)).toEqual(['Cafe\u0301 100%_\\']);
    }
    expect((await catalog.search({ keyword: 'alpha beta', limit: 20 })).items).toHaveLength(0);
  });

  it('searches player, card, and pack names independently', async () => {
    await importAndPublish([card(7, {
      playerNameZh: '传奇球员张',
      cardName: 'Golden Edition',
      packExternalId: 'legends',
      packName: 'Legends Collection'
    })]);
    for (const keyword of ['传奇球员', 'golden', 'legends collection']) {
      expect((await catalog.search({ keyword, limit: 20 })).items).toHaveLength(1);
    }
  });

  it('supports old published-at cursors for the rest of their snapshot', async () => {
    await importAndPublish(Array.from({ length: 12 }, (_, index) => card(index + 1)));
    const versions = await prisma.playerCardVersion.findMany({
      where: { playerCard: { sourceId } }, orderBy: [{ publishedAt: 'desc' }, { overallRating: 'desc' }, { playerCardId: 'asc' }]
    });
    const anchor = versions[4]!;
    const cursor = encodeCatalogCursor({
      releaseSequence: anchor.releaseSequence,
      publishedAt: anchor.publishedAt.toISOString(),
      overallRating: anchor.overallRating,
      id: anchor.playerCardId
    });
    const page = await catalog.search({ keyword: sourceCode, cursor, limit: 3 });
    expect(page.items.map((item) => item.id)).toEqual(versions.slice(5, 8).map((version) => version.playerCardId));
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCatalogCursor(page.nextCursor!)).toMatchObject({ releaseSequence: anchor.releaseSequence });
  });

  it('does not revive an old active version after a card is withdrawn', async () => {
    await importAndPublish([card(1)]);
    const active = (await catalog.search({ keyword: sourceCode, limit: 20 })).items[0]!;
    await importAndPublish([card(1, { status: 'INACTIVE' })]);
    expect((await catalog.search({ keyword: sourceCode, limit: 20 })).items).toHaveLength(0);
    await expect(catalog.getCard(active.id)).resolves.toMatchObject({ status: 'INACTIVE' });
  });

  it('counts current pack membership after a move and pages same-name packs by ID', async () => {
    await importAndPublish([
      card(1, { packExternalId: 'pack-a', packName: 'Shared' }),
      card(2, { packExternalId: 'pack-b', packName: 'Shared' }),
      card(3, { packExternalId: 'pack-c', packName: 'Shared' })
    ]);
    await importAndPublish([card(1, { packExternalId: 'pack-b', packName: 'Shared' })]);
    const first = await catalog.listPacks({ limit: 1 });
    const second = await catalog.listPacks({ limit: 1, cursor: first.nextCursor! });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
    expect([first.items[0]?.cardCount, second.items[0]?.cardCount].sort()).toEqual([1, 2]);
    const packIds = [...first.items, ...second.items].map((pack) => pack.id);
    expect(new Set(packIds).size).toBe(2);
    expect((await catalog.getPack(packIds[0]!)).cards).toHaveLength(first.items[0]!.cardCount);
  });

  it('returns player, card, and pack details and raises 404 for hidden IDs', async () => {
    await importAndPublish([card(1), card(2)]);
    const search = await catalog.search({ keyword: sourceCode, limit: 20 });
    const first = search.items[0]!;
    const player = await catalog.getPlayer(first.playerId);
    const detail = await catalog.getCard(first.id);
    const packs = await catalog.listPacks({ limit: 20 });
    const pack = await catalog.getPack(packs.items[0]!.id);

    expect(player.cards.length).toBeGreaterThan(0);
    expect(detail.skills).toEqual([expect.objectContaining({ code: 'passing' })]);
    expect(detail.otherCards).toEqual(expect.any(Array));
    expect(pack.cards).toHaveLength(2);
    await expect(catalog.getCard(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the newest persisted automatic build with a public card detail', async () => {
    await importAndPublish([card(3, {
      autoBuildAllocation: { shooting: 8, passing: 4, dribbling: 12 },
      autoBuildMaxOverall: 101,
      dtRating: 99,
      algorithmVersion: 'pesdata-auto-v1',
    })]);
    const [summary] = (await catalog.search({ keyword: sourceCode, limit: 20 })).items;

    await expect(catalog.getCard(summary!.id)).resolves.toMatchObject({
      autoBuild: {
        allocation: { shooting: 8, passing: 4, dribbling: 12 },
        maxOverall: 101,
        dtRating: 99,
        algorithmVersion: 'pesdata-auto-v1',
      },
    });
  });

  it('returns a fixed build for a published epic card with zero progression points', async () => {
    await importAndPublish([card(4, {
      overallRating: 87,
      cardType: 'EPIC',
      attributes: { sourceMetadata: { Level: '-', maxLevel: '0' } }
    })]);
    const [summary] = (await catalog.search({ keyword: sourceCode, limit: 20 })).items;

    await expect(catalog.getCard(summary!.id)).resolves.toMatchObject({
      overallRating: 87,
      autoBuild: {
        allocation: {},
        maxOverall: 87,
        dtRating: null,
        algorithmVersion: 'pesdata-final-card-v1'
      }
    });
  });
});
