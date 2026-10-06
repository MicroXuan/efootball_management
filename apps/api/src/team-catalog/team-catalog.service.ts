import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateCustomTeamCatalogItemRequest,
  TeamCatalogItem,
  TeamCatalogListResponse
} from '@efm/contracts';
import type { TeamCatalogItem as TeamCatalogRecord } from '../generated/prisma/client.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';

export type TeamCatalogListQuery = {
  keyword?: string;
  sourceLeagueName?: string;
  includeDisabled?: boolean;
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
    const records = await this.prisma.teamCatalogItem.findMany({
      where: {
        ...(query.includeDisabled ? {} : { status: 'ACTIVE' }),
        ...(sourceLeagueName ? { sourceLeagueName: { contains: sourceLeagueName } } : {}),
        ...(keyword ? {
          OR: [
            { nameZh: { contains: keyword } },
            { nameEn: { contains: keyword } },
            { nameJa: { contains: keyword } },
            { shortName: { contains: keyword } },
            { sourceLeagueName: { contains: keyword } }
          ]
        } : {})
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
