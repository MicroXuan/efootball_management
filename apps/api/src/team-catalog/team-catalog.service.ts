import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateCustomTeamCatalogItemRequest,
  TeamCatalogCandidate,
  TeamCatalogSyncDifference,
  TeamCatalogSyncRunSummary,
  TeamCatalogItem,
  TeamCatalogListResponse
} from '@efm/contracts';
import { TeamCatalogCandidateSchema } from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { TeamCatalogItem as TeamCatalogRecord } from '../generated/prisma/client.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';

export type TeamCatalogListQuery = {
  keyword?: string;
  sourceLeagueName?: string;
  includeDisabled?: boolean;
};

const sourceLeagueAliases: Readonly<Record<string, readonly string[]>> = {
  '英超': ['英超', '英格兰联赛'],
  '西甲': ['西甲', '西班牙联赛'],
  '意甲': ['意甲', '意大利甲组联赛'],
  '法甲': ['法甲', '法国足球甲级联赛'],
  '荷甲': ['荷甲', '荷兰足球甲级联赛'],
  '葡超': ['葡超', '葡萄牙足球超级联赛']
};

@Injectable()
export class TeamCatalogService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async listAvailable(leagueId: string, query: TeamCatalogListQuery = {}): Promise<TeamCatalogListResponse> {
    const keyword = query.keyword?.trim();
    const sourceLeagueName = query.sourceLeagueName?.trim();
    const sourceLeagueTerms = sourceLeagueName
      ? sourceLeagueAliases[sourceLeagueName] ?? [sourceLeagueName]
      : [];
    const records = await this.prisma.teamCatalogItem.findMany({
      where: {
        ...(query.includeDisabled ? {} : { status: 'ACTIVE' }),
        AND: [
          ...(sourceLeagueTerms.length ? [{
            OR: sourceLeagueTerms.map((term) => ({ sourceLeagueName: { contains: term } }))
          }] : []),
          ...(keyword ? [{
            OR: [
              { nameZh: { contains: keyword } },
              { nameEn: { contains: keyword } },
              { nameJa: { contains: keyword } },
              { shortName: { contains: keyword } },
              { sourceLeagueName: { contains: keyword } }
            ]
          }] : [])
        ]
      },
      include: {
        leagueTeams: {
          where: { leagueId },
          select: { id: true },
          take: 1
        }
      },
      orderBy: [{ sourceLeagueName: 'asc' }, { nameZh: 'asc' }, { nameEn: 'asc' }, { id: 'asc' }]
    });

    return {
      items: records.map(({ leagueTeams, ...record }) => this.present(record, leagueTeams[0]?.id ?? null)),
      nextCursor: null
    };
  }

  async createCustom(
    actorAdminId: string,
    input: CreateCustomTeamCatalogItemRequest
  ): Promise<TeamCatalogItem> {
    return this.prisma.$transaction(async (transaction) => {
      const record = await transaction.teamCatalogItem.create({
        data: {
          sourceType: 'CUSTOM',
          nameZh: input.nameZh,
          nameEn: input.nameEn ?? null,
          nameJa: input.nameJa ?? null,
          shortName: input.shortName,
          storedLogoUrl: input.storedLogoUrl,
          status: 'ACTIVE'
        }
      });
      await this.audit.record(transaction, {
        actorAdminId,
        action: 'CREATE_CUSTOM_TEAM_SHELL',
        resourceType: 'TeamCatalogItem',
        resourceId: record.id,
        metadata: { name: record.nameZh, shortName: record.shortName }
      });
      return this.present(record, null);
    });
  }

  async listSyncRuns(): Promise<{ items: TeamCatalogSyncRunSummary[] }> {
    const runs = await this.prisma.teamCatalogSyncRun.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
    return { items: runs.map((run) => ({
      id: run.id, mode: run.mode, status: run.status, scannedCount: run.scannedCount,
      addedCount: run.addedCount, updatedCount: run.updatedCount, missingCount: run.missingCount,
      failedCount: run.failedCount, createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null, errorCode: run.errorCode
    })) };
  }

  async listSyncDifferences(runId: string): Promise<{ items: TeamCatalogSyncDifference[] }> {
    const items = await this.prisma.teamCatalogSyncItem.findMany({
      where: { runId }, orderBy: [{ sourceExternalId: 'asc' }, { id: 'asc' }]
    });
    return { items: items.map((item) => ({
      id: item.id, runId: item.runId, sourceExternalId: item.sourceExternalId,
      changeType: item.changeType, reviewStatus: item.reviewStatus,
      currentCatalogItemId: item.currentCatalogItemId,
      candidate: item.candidateJson ? TeamCatalogCandidateSchema.parse(item.candidateJson) : null,
      errorCode: item.errorCode
    })) };
  }

  publishSyncItem(actorAdminId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM team_catalog_sync_items WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.teamCatalogSyncItem.findUnique({ where: { id: itemId } });
      if (!item) throw new Error('TEAM_CATALOG_SYNC_ITEM_NOT_FOUND');
      if (item.reviewStatus === 'PUBLISHED') return { ok: true as const };
      if (item.reviewStatus !== 'PENDING') throw new Error('TEAM_CATALOG_SYNC_ITEM_NOT_PENDING');
      let resourceId = item.currentCatalogItemId;
      if (item.changeType === 'SOURCE_MISSING') {
        if (!item.currentCatalogItemId) throw new Error('TEAM_CATALOG_SYNC_ITEM_INVALID');
        await tx.teamCatalogItem.update({ where: { id: item.currentCatalogItemId }, data: { status: 'SOURCE_UNCONFIRMED' } });
      } else {
        const candidate = TeamCatalogCandidateSchema.parse(item.candidateJson) as TeamCatalogCandidate;
        const data = {
          sourceType: 'PESDATA' as const,
          sourceExternalId: candidate.sourceExternalId,
          sourceLeagueExternalId: candidate.sourceLeagueExternalId,
          sourceLeagueName: candidate.sourceLeagueName,
          nameZh: candidate.nameZh,
          nameEn: candidate.nameEn,
          nameJa: candidate.nameJa,
          shortName: candidate.shortName,
          remoteLogoUrl: candidate.remoteLogoUrl,
          storedLogoUrl: candidate.storedLogoUrl,
          logoChecksum: this.logoChecksum(item.candidateJson),
          sourceChecksum: item.detailChecksum,
          status: 'ACTIVE' as const,
          sourceUpdatedAt: candidate.sourceUpdatedAt ? new Date(candidate.sourceUpdatedAt) : null,
          lastSyncedAt: new Date()
        };
        if (item.currentCatalogItemId) {
          await tx.teamCatalogItem.update({ where: { id: item.currentCatalogItemId }, data });
          resourceId = item.currentCatalogItemId;
        } else {
          const created = await tx.teamCatalogItem.upsert({
            where: { sourceType_sourceExternalId: { sourceType: 'PESDATA', sourceExternalId: candidate.sourceExternalId } },
            update: data,
            create: data
          });
          resourceId = created.id;
        }
      }
      await tx.teamCatalogSyncItem.update({ where: { id: item.id }, data: { reviewStatus: 'PUBLISHED', currentCatalogItemId: resourceId } });
      await this.audit.record(tx, { actorAdminId, action: 'PUBLISH_TEAM_CATALOG_SYNC_ITEM', resourceType: 'TeamCatalogSyncItem', resourceId: item.id, metadata: { changeType: item.changeType, catalogTeamId: resourceId } });
      return { ok: true as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  rejectSyncItem(actorAdminId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.teamCatalogSyncItem.findUnique({ where: { id: itemId } });
      if (!item) throw new Error('TEAM_CATALOG_SYNC_ITEM_NOT_FOUND');
      await tx.teamCatalogSyncItem.update({ where: { id: itemId }, data: { reviewStatus: 'REJECTED' } });
      await this.audit.record(tx, { actorAdminId, action: 'REJECT_TEAM_CATALOG_SYNC_ITEM', resourceType: 'TeamCatalogSyncItem', resourceId: item.id, metadata: { changeType: item.changeType } });
      return { ok: true as const };
    });
  }

  private logoChecksum(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const checksum = (value as Record<string, Prisma.JsonValue>).logoChecksum;
    return typeof checksum === 'string' && /^[a-f0-9]{64}$/.test(checksum) ? checksum : null;
  }

  private present(record: TeamCatalogRecord, assignedLeagueTeamId: string | null): TeamCatalogItem {
    return {
      id: record.id,
      sourceType: record.sourceType,
      sourceExternalId: record.sourceExternalId,
      sourceLeagueExternalId: record.sourceLeagueExternalId,
      sourceLeagueName: record.sourceLeagueName,
      nameZh: record.nameZh,
      nameEn: record.nameEn,
      nameJa: record.nameJa,
      shortName: record.shortName,
      remoteLogoUrl: record.remoteLogoUrl,
      storedLogoUrl: record.storedLogoUrl,
      status: record.status,
      sourceUpdatedAt: record.sourceUpdatedAt?.toISOString() ?? null,
      lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      isAssigned: assignedLeagueTeamId !== null,
      assignedLeagueTeamId
    };
  }
}
