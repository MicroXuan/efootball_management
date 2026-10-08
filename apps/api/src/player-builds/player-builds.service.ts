import { Inject, Injectable } from '@nestjs/common';
import { derivePesdataPositionAutoBuild } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { selectBestCard } from './player-build-selector.js';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

export type SavePlayerBuildInput = {
  autoBuildAllocation: Record<string, number>;
  autoBuildMaxOverall: number;
  dtRating: number | null;
  algorithmVersion: string;
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class PlayerBuildsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  save(playerCardId: string, input: SavePlayerBuildInput) {
    return this.prisma.$transaction((tx) => this.saveWithClient(tx, playerCardId, input));
  }

  async resolveOrDeriveWithClient(client: DatabaseClient, playerCardId: string) {
    const existing = await client.playerCardAutoBuild.findFirst({
      where: { playerCardId },
      orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
      include: { playerCard: true }
    });
    if (existing?.dtRating != null) return existing;
    if (existing) {
      return client.playerCardAutoBuild.update({
        where: { id: existing.id },
        data: { dtRating: existing.maxOverall, calculatedAt: new Date() },
        include: { playerCard: true }
      });
    }

    const card = await client.playerCard.findUnique({
      where: { id: playerCardId },
      include: { attributes: true }
    });
    if (!card) return null;
    const attributes = objectRecord(card.attributes?.attributesJson);
    const sourceMetadata = objectRecord(attributes?.sourceMetadata);
    const build = derivePesdataPositionAutoBuild({
      position: card.position,
      overallRating: card.overallRating,
      maxLevel: sourceMetadata?.maxLevel as number | string | null | undefined,
      cardType: card.cardType
    });
    if (!build) return null;

    await this.saveWithClient(client, playerCardId, {
      autoBuildAllocation: build.allocation,
      autoBuildMaxOverall: build.maxOverall,
      dtRating: build.dtRating,
      algorithmVersion: build.algorithmVersion
    });
    return client.playerCardAutoBuild.findUniqueOrThrow({
      where: {
        playerCardId_algorithmVersion: {
          playerCardId,
          algorithmVersion: build.algorithmVersion
        }
      },
      include: { playerCard: true }
    });
  }

  async saveWithClient(client: DatabaseClient, playerCardId: string, input: SavePlayerBuildInput) {
    const card = await client.playerCard.findUniqueOrThrow({
      where: { id: playerCardId },
      select: { playerId: true }
    });
    const saved = await client.playerCardAutoBuild.upsert({
      where: {
        playerCardId_algorithmVersion: {
          playerCardId,
          algorithmVersion: input.algorithmVersion
        }
      },
      create: {
        playerCardId,
        algorithmVersion: input.algorithmVersion,
        allocationJson: asJson(input.autoBuildAllocation),
        maxOverall: input.autoBuildMaxOverall,
        dtRating: input.dtRating
      },
      update: {
        allocationJson: asJson(input.autoBuildAllocation),
        maxOverall: input.autoBuildMaxOverall,
        dtRating: input.dtRating,
        calculatedAt: new Date()
      }
    });

    const builds = await client.playerCardAutoBuild.findMany({
      where: {
        algorithmVersion: input.algorithmVersion,
        playerCard: { playerId: card.playerId }
      },
      include: {
        playerCard: {
          select: {
            externalId: true,
            cardPack: { select: { releaseDate: true } }
          }
        }
      }
    });
    const selection = selectBestCard(builds.map((build) => ({
      autoBuildId: build.id,
      playerCardId: build.playerCardId,
      externalId: build.playerCard.externalId,
      algorithmVersion: build.algorithmVersion,
      maxOverall: build.maxOverall,
      dtRating: build.dtRating,
      releaseDate: build.playerCard.cardPack?.releaseDate ?? null
    })));
    if (!selection) return saved;

    await client.footballPlayerBestCard.upsert({
      where: { footballPlayerId: card.playerId },
      create: {
        footballPlayerId: card.playerId,
        playerCardId: selection.playerCardId,
        autoBuildId: selection.autoBuildId,
        selectionReason: asJson(selection.selectionReason)
      },
      update: {
        playerCardId: selection.playerCardId,
        autoBuildId: selection.autoBuildId,
        selectionReason: asJson(selection.selectionReason),
        selectedAt: new Date()
      }
    });
    return saved;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
