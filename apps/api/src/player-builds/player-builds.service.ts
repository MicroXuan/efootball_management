import { Inject, Injectable } from '@nestjs/common';
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
