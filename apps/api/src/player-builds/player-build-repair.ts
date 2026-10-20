import type { PrismaService } from '../database/prisma.service.js';
import { PlayerBuildsService } from './player-builds.service.js';

export type PlayerBuildRepairMode = 'dry-run' | 'apply';
export type PlayerBuildRepairReport = { candidates: number; repaired: number; skipped: number };

function sourceMaxLevel(attributesJson: unknown): number | null {
  if (typeof attributesJson !== 'object' || attributesJson === null || Array.isArray(attributesJson)) return null;
  const sourceMetadata = (attributesJson as Record<string, unknown>).sourceMetadata;
  if (typeof sourceMetadata !== 'object' || sourceMetadata === null || Array.isArray(sourceMetadata)) return null;
  const value = (sourceMetadata as Record<string, unknown>).maxLevel;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function repairMissingPlayerBuilds(
  prisma: PrismaService,
  mode: PlayerBuildRepairMode
): Promise<PlayerBuildRepairReport> {
  const rows = await prisma.playerCard.findMany({
    where: {
      status: 'ACTIVE',
      publishedAt: { not: null },
      autoBuilds: { none: {} }
    },
    select: {
      id: true,
      attributes: { select: { attributesJson: true } }
    }
  });
  const candidates = rows.filter(({ attributes }) => sourceMaxLevel(attributes?.attributesJson) === 0);
  if (mode === 'dry-run') {
    return { candidates: candidates.length, repaired: 0, skipped: candidates.length };
  }

  const builds = new PlayerBuildsService(prisma);
  let repaired = 0;
  let skipped = 0;
  for (const card of candidates) {
    const created = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.playerCardAutoBuild.count({ where: { playerCardId: card.id } });
      if (existing > 0) return false;
      return Boolean(await builds.resolveOrDeriveWithClient(transaction, card.id));
    });
    if (created) repaired += 1;
    else skipped += 1;
  }
  return { candidates: candidates.length, repaired, skipped };
}
