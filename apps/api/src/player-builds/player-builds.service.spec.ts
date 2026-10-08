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

  async function createCard(externalId: string, releaseDate: string) {
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
        position: 'CB',
        overallRating: 87,
        cardType: 'EPIC'
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

  it('backfills a legacy PESDATA card from its progression level on first use', async () => {
    const card = await createCard('legacy-dmf-80', '2026-10-01');
    await prisma.playerCard.update({
      where: { id: card.id },
      data: { position: 'DMF', overallRating: 80, cardType: 'HIGHLIGHT' }
    });
    await prisma.playerCardAttribute.create({
      data: {
        playerCardId: card.id,
        attributesJson: { sourceMetadata: { maxLevel: 80 } }
      }
    });

    const build = await service.resolveOrDeriveWithClient(prisma, card.id);

    expect(build).toMatchObject({
      maxOverall: 95,
      dtRating: 95,
      algorithmVersion: 'pesdata-position-auto-v1'
    });
    await expect(prisma.playerCardAutoBuild.count({ where: { playerCardId: card.id } }))
      .resolves.toBe(1);
  });

  it('refreshes the recommendation deterministically while preserving every card', async () => {
    const first = await createCard('bonucci-z', '2026-09-24');
    const second = await createCard('bonucci-a', '2026-09-24');
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
    expect(recommendation?.playerCardId).toBe(second.id);
    expect(recommendation?.selectionReason).toMatchObject({ candidateCount: 2 });
    await expect(prisma.playerCard.count({ where: { playerId } })).resolves.toBe(2);
  });
});
