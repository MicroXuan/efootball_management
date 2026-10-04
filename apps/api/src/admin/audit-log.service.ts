import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

type AuditClient = PrismaService | Prisma.TransactionClient;
type AuditInput = {
  actorAdminId?: string;
  actorUserId?: string;
  leagueId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY = /password|token|secret/i;

function metadataRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function stringMetadata(metadata: Record<string, Prisma.JsonValue>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' ? value : null;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, entry]) => [key, sanitize(entry)])
    );
  }
  return value;
}

@Injectable()
export class AuditLogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  record(client: AuditClient, input: AuditInput) {
    if (Boolean(input.actorAdminId) === Boolean(input.actorUserId)) {
      throw new Error('Audit records require exactly one actor');
    }
    return client.auditLog.create({
      data: {
        actorAdminId: input.actorAdminId ?? null,
        actorUserId: input.actorUserId ?? null,
        leagueId: input.leagueId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        reason: input.reason ?? null,
        metadata: sanitize(input.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
  }

  async list(leagueId?: string) {
    const logs = await this.prisma.auditLog.findMany({
      ...(leagueId ? { where: { leagueId } } : {}),
      include: {
        actorAdmin: { select: { displayName: true } },
        actorUser: { select: { displayName: true } },
        league: { select: { name: true } }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100
    });
    const seasonIds = new Set<string>();
    for (const log of logs) {
      const metadata = metadataRecord(log.metadata);
      for (const key of ['seasonId', 'newSeasonId']) {
        const id = stringMetadata(metadata, key);
        if (id) seasonIds.add(id);
      }
      if (log.resourceType === 'LeagueSeason' && log.resourceId) seasonIds.add(log.resourceId);
    }
    const seasons = seasonIds.size
      ? await this.prisma.leagueSeason.findMany({
        where: { id: { in: [...seasonIds] } },
        select: { id: true, displayName: true }
      })
      : [];
    const seasonNames = new Map(seasons.map((season) => [season.id, season.displayName]));

    return logs.map(({ actorAdmin, actorUser, league, ...log }) => {
      const metadata = metadataRecord(log.metadata);
      const seasonId = log.action === 'admin.league-season.set-current'
        ? stringMetadata(metadata, 'newSeasonId')
        : stringMetadata(metadata, 'seasonId')
          ?? (log.resourceType === 'LeagueSeason' ? log.resourceId : null);
      const metadataName = stringMetadata(metadata, 'displayName')
        ?? stringMetadata(metadata, 'name')
        ?? stringMetadata(metadata, 'username');
      return {
        ...log,
        actorDisplayName: actorAdmin?.displayName ?? actorUser?.displayName ?? '未知用户',
        leagueName: league?.name ?? null,
        subjectDisplayName: seasonId
          ? seasonNames.get(seasonId) ?? metadataName
          : metadataName ?? (log.resourceType === 'League' ? league?.name ?? null : null),
        createdAt: log.createdAt.toISOString()
      };
    });
  }
}
