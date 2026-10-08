import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateCustomTeamCatalogItemRequest,
  TeamCatalogCandidate,
  TeamCatalogSyncDifference,
  TeamCatalogSyncRunSummary,
  TeamCatalogItem,
  TeamCatalogListResponse,
  PlatformPageRequest,
  TeamSyncItemPage
} from '@efm/contracts';
import { TeamCatalogCandidateSchema } from '@efm/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { TeamCatalogItem as TeamCatalogRecord } from '../generated/prisma/client.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

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
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(LeagueVisibilityService) private readonly visibility: LeagueVisibilityService
  ) {}

  async listAvailable(leagueId: string, query: TeamCatalogListQuery = {}): Promise<TeamCatalogListResponse> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
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

  async listSyncDifferencesPage(
    runId: string,
    query: PlatformPageRequest
  ): Promise<TeamSyncItemPage> {
    const statuses = this.reviewStatuses(query.status);
    const changeTypes = this.changeTypes(query.changeType);
    const baseWhere: Prisma.TeamCatalogSyncItemWhereInput = {
      runId,
      reviewStatus: { in: statuses },
      ...(changeTypes ? { changeType: { in: changeTypes } } : {}),
      ...(query.errorCode ? { errorCode: query.errorCode } : {})
    };
    const needsJsonSearch = Boolean(query.query || query.sourceLeagueId);
    let records;
    let total: number;
    if (needsJsonSearch) {
      const conditions: Prisma.Sql[] = [
        Prisma.sql`run_id = ${runId}`,
        Prisma.sql`review_status IN (${Prisma.join(statuses)})`
      ];
      if (changeTypes) conditions.push(Prisma.sql`change_type IN (${Prisma.join(changeTypes)})`);
      if (query.errorCode) conditions.push(Prisma.sql`error_code = ${query.errorCode}`);
      if (query.sourceLeagueId) {
        conditions.push(Prisma.sql`JSON_UNQUOTE(JSON_EXTRACT(candidate_json, '$.sourceLeagueExternalId')) = ${query.sourceLeagueId}`);
      }
      if (query.query) {
        const pattern = `%${query.query}%`;
        conditions.push(Prisma.sql`(
          source_external_id LIKE ${pattern}
          OR JSON_UNQUOTE(JSON_EXTRACT(candidate_json, '$.nameZh')) LIKE ${pattern}
          OR JSON_UNQUOTE(JSON_EXTRACT(candidate_json, '$.nameEn')) LIKE ${pattern}
          OR JSON_UNQUOTE(JSON_EXTRACT(candidate_json, '$.nameJa')) LIKE ${pattern}
          OR JSON_UNQUOTE(JSON_EXTRACT(candidate_json, '$.shortName')) LIKE ${pattern}
        )`);
      }
      const whereSql = Prisma.join(conditions, ' AND ');
      const sortColumn = query.sortBy === 'sourceExternalId'
        ? Prisma.sql`source_external_id`
        : query.sortBy === 'status'
          ? Prisma.sql`review_status`
          : query.sortBy === 'createdAt'
            ? Prisma.sql`created_at`
            : Prisma.sql`updated_at`;
      const direction = query.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
      const offset = (query.page - 1) * query.pageSize;
      const [ids, counts] = await this.prisma.$transaction([
        this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM team_catalog_sync_items
          WHERE ${whereSql}
          ORDER BY ${sortColumn} ${direction}, id ${direction}
          LIMIT ${query.pageSize} OFFSET ${offset}
        `),
        this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
          SELECT COUNT(*) AS total FROM team_catalog_sync_items WHERE ${whereSql}
        `)
      ]);
      const rows = ids.length ? await this.prisma.teamCatalogSyncItem.findMany({
        where: { id: { in: ids.map(({ id }) => id) } }, include: { currentCatalogItem: true }
      }) : [];
      const positions = new Map(ids.map(({ id }, index) => [id, index]));
      records = rows.sort((left, right) => (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0));
      total = Number(counts[0]?.total ?? 0);
    } else {
      [records, total] = await this.prisma.$transaction([
        this.prisma.teamCatalogSyncItem.findMany({
          where: baseWhere,
          include: { currentCatalogItem: true },
          orderBy: this.syncItemOrder(query.sortBy, query.sortOrder),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize
        }),
        this.prisma.teamCatalogSyncItem.count({ where: baseWhere })
      ]);
    }
    const [statusGroups, errorGroups] = await Promise.all([
      this.prisma.teamCatalogSyncItem.groupBy({
        by: ['reviewStatus'], where: { runId }, orderBy: { reviewStatus: 'asc' }, _count: { reviewStatus: true }
      }),
      this.prisma.teamCatalogSyncItem.groupBy({
        by: ['errorCode'], where: { runId, errorCode: { not: null } }, _count: { errorCode: true }, orderBy: { errorCode: 'asc' }
      })
    ]);
    const statusCount = new Map(statusGroups.map((entry) => [entry.reviewStatus, entry._count.reviewStatus]));
    return {
      items: records.map((item) => ({
        id: item.id,
        runId: item.runId,
        sourceExternalId: item.sourceExternalId,
        changeType: item.changeType,
        reviewStatus: item.reviewStatus,
        currentCatalogItemId: item.currentCatalogItemId,
        candidate: item.candidateJson ? TeamCatalogCandidateSchema.parse(item.candidateJson) : null,
        current: item.currentCatalogItem ? {
          nameZh: item.currentCatalogItem.nameZh,
          nameEn: item.currentCatalogItem.nameEn,
          shortName: item.currentCatalogItem.shortName,
          remoteLogoUrl: item.currentCatalogItem.remoteLogoUrl,
          storedLogoUrl: item.currentCatalogItem.storedLogoUrl,
          logoChecksum: item.currentCatalogItem.logoChecksum,
          sourceChecksum: item.currentCatalogItem.sourceChecksum
        } : null,
        candidateLogoChecksum: this.logoChecksum(item.candidateJson),
        candidateSourceChecksum: item.detailChecksum,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      summary: {
        pending: statusCount.get('PENDING') ?? 0,
        failed: statusCount.get('FAILED') ?? 0,
        published: statusCount.get('PUBLISHED') ?? 0,
        rejected: statusCount.get('REJECTED') ?? 0,
        errors: errorGroups.flatMap((entry) => entry.errorCode
          ? [{ code: entry.errorCode, count: entry._count.errorCode }]
          : [])
      }
    };
  }

  publishSyncItem(actorAdminId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM team_catalog_sync_items WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.teamCatalogSyncItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException({ code: 'TEAM_SYNC_ITEM_NOT_FOUND', message: 'Team sync item was not found' });
      if (item.reviewStatus === 'PUBLISHED') return { ok: true as const };
      if (item.reviewStatus !== 'PENDING') {
        throw new ConflictException({ code: 'TEAM_SYNC_ITEM_NOT_PENDING', message: 'Only pending team sync items can be published' });
      }
      let resourceId = item.currentCatalogItemId;
      if (item.changeType === 'SOURCE_MISSING') {
        if (!item.currentCatalogItemId) {
          throw new ConflictException({ code: 'TEAM_SYNC_ITEM_INVALID', message: 'Source-missing item has no catalog record' });
        }
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
      await this.audit.record(tx, {
        actorAdminId,
        action: 'PUBLISH_TEAM_SHELL_SYNC_ITEM',
        resourceType: 'TeamCatalogSyncItem',
        resourceId: item.id,
        metadata: { changeType: item.changeType, catalogTeamId: resourceId }
      });
      return { ok: true as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  rejectSyncItem(actorAdminId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM team_catalog_sync_items WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.teamCatalogSyncItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException({ code: 'TEAM_SYNC_ITEM_NOT_FOUND', message: 'Team sync item was not found' });
      if (item.reviewStatus === 'REJECTED') return { ok: true as const };
      if (item.reviewStatus !== 'PENDING') {
        throw new ConflictException({ code: 'TEAM_SYNC_ITEM_NOT_PENDING', message: 'Only pending team sync items can be rejected' });
      }
      await tx.teamCatalogSyncItem.update({ where: { id: itemId }, data: { reviewStatus: 'REJECTED' } });
      await this.audit.record(tx, {
        actorAdminId,
        action: 'REJECT_TEAM_SHELL_SYNC_ITEM',
        resourceType: 'TeamCatalogSyncItem',
        resourceId: item.id,
        metadata: { changeType: item.changeType }
      });
      return { ok: true as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private logoChecksum(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const checksum = (value as Record<string, Prisma.JsonValue>).logoChecksum;
    return typeof checksum === 'string' && /^[a-f0-9]{64}$/.test(checksum) ? checksum : null;
  }

  private reviewStatuses(values: string[] | undefined) {
    const allowed = new Set(['PENDING', 'PUBLISHED', 'REJECTED', 'FAILED'] as const);
    const requested = values ?? ['PENDING', 'FAILED'];
    const accepted = requested.filter((value): value is 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'FAILED' =>
      allowed.has(value as 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'FAILED')
    );
    if (accepted.length !== requested.length || accepted.length === 0) {
      throw new BadRequestException({ code: 'INVALID_SYNC_FILTER', message: 'Unknown team sync review status' });
    }
    return accepted;
  }

  private changeTypes(values: string[] | undefined) {
    if (!values?.length) return undefined;
    const allowed = new Set(['ADDED', 'UPDATED', 'SOURCE_MISSING'] as const);
    const accepted = values.filter((value): value is 'ADDED' | 'UPDATED' | 'SOURCE_MISSING' =>
      allowed.has(value as 'ADDED' | 'UPDATED' | 'SOURCE_MISSING')
    );
    if (accepted.length !== values.length || accepted.length === 0) {
      throw new BadRequestException({ code: 'INVALID_SYNC_FILTER', message: 'Unknown team sync change type' });
    }
    return accepted;
  }

  private syncItemOrder(sortBy?: string, sortOrder?: 'asc' | 'desc'): Prisma.TeamCatalogSyncItemOrderByWithRelationInput[] {
    const direction = sortOrder ?? 'desc';
    const first: Prisma.TeamCatalogSyncItemOrderByWithRelationInput = sortBy === 'sourceExternalId'
      ? { sourceExternalId: direction }
      : sortBy === 'status'
        ? { reviewStatus: direction }
        : sortBy === 'createdAt'
          ? { createdAt: direction }
          : { updatedAt: direction };
    return [first, { id: direction }];
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
