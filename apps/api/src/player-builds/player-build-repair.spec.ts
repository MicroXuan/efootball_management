import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../database/prisma.service.js';
import { PlayerBuildsService } from './player-builds.service.js';
import { parsePlayerBuildRepairArgs } from './player-build-repair.cli.js';
import { repairMissingPlayerBuilds } from './player-build-repair.js';

config({ path: '../../.env', quiet: true });

describe('missing player build repair', () => {
  const prisma = new PrismaService();
  const builds = new PlayerBuildsService(prisma);
  let sourceId: string;
  let playerId: string;
  const cardIds: string[] = [];

  beforeAll(() => prisma.$connect());

  beforeEach(async () => {
    const source = await prisma.dataSource.create({
      data: { code: `repair-source-${randomUUID()}`, name: 'Repair test' }
    });
    sourceId = source.id;
    playerId = (await prisma.footballPlayer.create({ data: { nameEn: 'Repair Player' } })).id;
  });

  afterEach(async () => {
    await prisma.footballPlayerBestCard.deleteMany({ where: { footballPlayerId: playerId } });
    await prisma.playerCard.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.footballPlayer.delete({ where: { id: playerId } });
    await prisma.dataSource.delete({ where: { id: sourceId } });
    cardIds.length = 0;
  });

  afterAll(() => prisma.$disconnect());

  async function createCard(input: {
    externalId: string;
    overallRating: number;
    maxLevel: number | string;
    published?: boolean;
  }) {
    const card = await prisma.playerCard.create({
      data: {
        sourceId,
        playerId,
        externalId: input.externalId,
        cardName: input.externalId,
        position: 'DMF',
        overallRating: input.overallRating,
        cardType: 'EPIC',
        publishedAt: input.published === false ? null : new Date('2026-10-19T00:00:00.000Z'),
        attributes: { create: { attributesJson: { sourceMetadata: { maxLevel: input.maxLevel } } } }
      }
    });
    cardIds.push(card.id);
    return card;
  }

  it('supports dry-run and repairs each eligible zero-level card once', async () => {
    const eligible = await createCard({ externalId: 'eligible', overallRating: 87, maxLevel: ' 0 ' });
    await createCard({ externalId: 'unpublished', overallRating: 88, maxLevel: 0, published: false });
    const existing = await createCard({ externalId: 'existing', overallRating: 89, maxLevel: 0 });
    await builds.resolveOrDeriveWithClient(prisma, existing.id);

    await expect(repairMissingPlayerBuilds(prisma, 'dry-run')).resolves.toEqual({
      candidates: 1, repaired: 0, skipped: 1
    });
    await expect(prisma.playerCardAutoBuild.count({ where: { playerCardId: eligible.id } })).resolves.toBe(0);

    await expect(repairMissingPlayerBuilds(prisma, 'apply')).resolves.toEqual({
      candidates: 1, repaired: 1, skipped: 0
    });
    await expect(prisma.playerCardAutoBuild.findFirst({ where: { playerCardId: eligible.id } }))
      .resolves.toMatchObject({ algorithmVersion: 'pesdata-final-card-v1', maxOverall: 87 });
    await expect(repairMissingPlayerBuilds(prisma, 'apply')).resolves.toEqual({
      candidates: 0, repaired: 0, skipped: 0
    });
  }, 30_000);

  it('does not replace a stronger existing best-card selection', async () => {
    const strong = await createCard({ externalId: 'strong', overallRating: 99, maxLevel: 0 });
    await builds.save(strong.id, {
      autoBuildAllocation: {}, autoBuildMaxOverall: 101, dtRating: null,
      algorithmVersion: 'pesdata-final-card-v1'
    });
    const weak = await createCard({ externalId: 'weak', overallRating: 87, maxLevel: 0 });

    await repairMissingPlayerBuilds(prisma, 'apply');

    await expect(prisma.footballPlayerBestCard.findUnique({ where: { footballPlayerId: playerId } }))
      .resolves.toMatchObject({ playerCardId: strong.id });
    await expect(prisma.playerCardAutoBuild.count({ where: { playerCardId: weak.id } })).resolves.toBe(1);
  }, 30_000);

  it('requires exactly one repair mode', () => {
    expect(parsePlayerBuildRepairArgs(['--dry-run'])).toEqual({ mode: 'dry-run' });
    expect(parsePlayerBuildRepairArgs(['--apply'])).toEqual({ mode: 'apply' });
    expect(() => parsePlayerBuildRepairArgs([])).toThrow('USE_EXACTLY_ONE_OF_DRY_RUN_OR_APPLY');
    expect(() => parsePlayerBuildRepairArgs(['--dry-run', '--apply']))
      .toThrow('USE_EXACTLY_ONE_OF_DRY_RUN_OR_APPLY');
  });
});
