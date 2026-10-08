import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerBuildsService } from './player-builds.service.js';

config({ path: '../../.env', quiet: true });

describe('PlayerBuildsService', () => {
  const prisma = new PrismaService();
  const service = new PlayerBuildsService(prisma);
  let sourceId: string;
  let playerId: string;
  const cardIds: string[] = [];
  const packIds: string[] = [];

  beforeAll(() => prisma.$connect());

  beforeEach(async () => {
    const source = await prisma.dataSource.create({
      data: { code: `build-source-${randomUUID()}`, name: 'Build test' }
    });
    sourceId = source.id;
    const player = await prisma.footballPlayer.create({ data: { nameEn: 'Leonardo Bonucci' } });
    playerId = player.id;
  });

  afterEach(async () => {
    await prisma.footballPlayerBestCard.deleteMany({ where: { footballPlayerId: playerId } });
    await prisma.playerCardAutoBuild.deleteMany({ where: { playerCardId: { in: cardIds } } });
    await prisma.playerCard.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.cardPack.deleteMany({ where: { id: { in: packIds } } });
    await prisma.footballPlayer.delete({ where: { id: playerId } });
    await prisma.dataSource.delete({ where: { id: sourceId } });
    cardIds.length = 0;
    packIds.length = 0;
  });

  afterAll(() => prisma.$disconnect());

  async function createCard(
    externalId: string,
    releaseDate: string,
    options: { position?: 'CB' | 'DMF'; overallRating?: number; cardType?: 'EPIC' | 'TRENDING'; maxLevel?: number } = {}
  ) {
    const pack = await prisma.cardPack.create({
      data: {
        sourceId,
        externalId: `pack-${externalId}`,
        releaseDate: new Date(`${releaseDate}T00:00:00.000Z`)
      }
    });
    const card = await prisma.playerCard.create({
      data: {
        sourceId,
        externalId,
        playerId,
        cardPackId: pack.id,
        cardName: externalId,
        position: options.position ?? 'CB',
        overallRating: options.overallRating ?? 87,
        cardType: options.cardType ?? 'EPIC',
        ...(options.maxLevel === undefined ? {} : {
          attributes: {
            create: { attributesJson: { sourceMetadata: { maxLevel: options.maxLevel } } }
          }
        })
      }
    });
    cardIds.push(card.id);
    packIds.push(pack.id);
    return card;
  }

  it('upserts one result per card and algorithm version', async () => {
    const card = await createCard('bonucci-87', '2026-09-24');

    await service.save(card.id, {
      autoBuildAllocation: { defending: 12 },
      autoBuildMaxOverall: 98,
      dtRating: 97,
      algorithmVersion: 'pesdata-auto-v1'
    });
    await service.save(card.id, {
      autoBuildAllocation: { defending: 13 },
      autoBuildMaxOverall: 99,
      dtRating: 98,
      algorithmVersion: 'pesdata-auto-v1'
    });

    await expect(prisma.playerCardAutoBuild.count({ where: { playerCardId: card.id } }))
      .resolves.toBe(1);
    await expect(prisma.playerCardAutoBuild.findFirst({ where: { playerCardId: card.id } }))
      .resolves.toMatchObject({ maxOverall: 99, dtRating: 98 });
  });

  it('refreshes the recommendation deterministically while preserving every card', async () => {
    const first = await createCard('bonucci-z', '2026-09-24');
    const second = await createCard('bonucci-a', '2025-09-24');
    await service.save(first.id, {
      autoBuildAllocation: { defending: 12 },
      autoBuildMaxOverall: 98,
      dtRating: null,
      algorithmVersion: 'pesdata-auto-v1'
    });
    await service.save(second.id, {
      autoBuildAllocation: { defending: 11 },
      autoBuildMaxOverall: 98,
      dtRating: 97,
      algorithmVersion: 'pesdata-auto-v1'
    });

    const recommendation = await prisma.footballPlayerBestCard.findUnique({
      where: { footballPlayerId: playerId }
    });
    expect(recommendation?.playerCardId).toBe(first.id);
    expect(recommendation?.selectionReason).toMatchObject({ candidateCount: 2 });
    expect(recommendation?.selectionReason).not.toHaveProperty('winner.dtRating');
    await expect(prisma.playerCard.count({ where: { playerId } })).resolves.toBe(2);
  });

  it('derives and persists a fixed build for a legacy trending card', async () => {
    const card = await createCard('olise-potw', '2026-10-01', {
      position: 'DMF',
      overallRating: 96,
      cardType: 'TRENDING'
    });

    const build = await prisma.$transaction((tx) => service.resolveOrDeriveWithClient(tx, card.id));

    expect(build).toMatchObject({
      playerCardId: card.id,
      maxOverall: 96,
      dtRating: null,
      algorithmVersion: 'pesdata-final-card-v1',
      allocationJson: {}
    });
    await expect(prisma.playerCardAutoBuild.count({ where: { playerCardId: card.id } }))
      .resolves.toBe(1);
  });

  it('derives and persists a position build for a legacy trainable card', async () => {
    const card = await createCard('legacy-dmf', '2026-09-24', {
      position: 'DMF',
      overallRating: 80,
      maxLevel: 80
    });

    const build = await prisma.$transaction((tx) => service.resolveOrDeriveWithClient(tx, card.id));

    expect(build).toMatchObject({
      playerCardId: card.id,
      maxOverall: 95,
      dtRating: 95,
      algorithmVersion: 'pesdata-position-auto-v1'
    });
    expect(build?.allocationJson).toMatchObject({ defending: 16, passing: 8 });
  });
});
