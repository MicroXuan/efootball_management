import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerImportPublisher } from '../player-import/player-import.publisher.js';
import { PlayerImportService } from '../player-import/player-import.service.js';
import { decodeCatalogCursor, encodeCatalogCursor } from './catalog-cursor.js';
import { PlayerCatalogService } from './player-catalog.service.js';

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
  const publisher = new PlayerImportPublisher(prisma, authorization as never);
  const catalog = new PlayerCatalogService(prisma);
  const actorId = randomUUID();
  let sourceId: string;
  let sourceCode: string;

  const card = (index: number, overrides: Record<string, unknown> = {}) => ({
    externalId: `catalog-${index}`,
    playerExternalId: `catalog-player-${index}`,
    playerNameEn: index === 1 ? 'Ａｌｅｘｉｓ' : `Catalog Player ${index}`,
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
    sourceCode = `catalog-${randomUUID()}`;
    sourceId = (await prisma.dataSource.create({ data: { code: sourceCode, name: 'Catalog test' } })).id;
  });

  afterEach(async () => {
    const cards = await prisma.playerCard.findMany({ where: { sourceId }, select: { id: true, playerId: true } });
    const cardIds = cards.map(({ id }) => id);
    const playerIds = [...new Set(cards.map(({ playerId }) => playerId))];
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
      card(1, { overallRating: 97, position: 'AMF', cardType: 'FEATURED' }),
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
      keyword: 'Alexis',
      position: 'AMF',
      minOverall: 95,
      cardType: 'FEATURED',
      limit: 20
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.playerNameEn).toBe('Ａｌｅｘｉｓ');
    expect(result.items.every((item) => item.id !== 'unpublished')).toBe(true);
  });

  it('keeps all original IDs stable across pages after a later release', async () => {
    await importAndPublish(Array.from({ length: 25 }, (_, index) => card(index + 1)));
    const firstPage = await catalog.search({ limit: 10 });
    expect(firstPage.items).toHaveLength(10);
    expect(firstPage.nextCursor).not.toBeNull();

    await importAndPublish([
      card(15, { overallRating: 109 }),
      card(26, { overallRating: 110 })
    ]);

    const seen = [...firstPage.items.map(({ id }) => id)];
    let cursor = firstPage.nextCursor;
    while (cursor) {
      const page = await catalog.search({ cursor, limit: 10 });
      expect(page.releaseSequence).toBe(firstPage.releaseSequence);
      seen.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    const latest = await catalog.search({ limit: 100 });
    expect(latest.items).toHaveLength(26);
    expect(latest.items[0]?.overallRating).toBe(110);
  });

  it('returns player, card, and pack details and raises 404 for hidden IDs', async () => {
    await importAndPublish([card(1), card(2)]);
    const search = await catalog.search({ limit: 20 });
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
});
