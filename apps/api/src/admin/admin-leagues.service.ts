import { Inject, Injectable } from '@nestjs/common';
import type { ParsedCreateLeagueRequest, UpdateLeagueRequest } from '@efm/contracts';
import type { League } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminError } from './admin.errors.js';
import { AdminMutationReceiptService } from './admin-mutation-receipt.service.js';
import { AuditLogService } from './audit-log.service.js';

@Injectable()
export class AdminLeaguesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  create(actorAdminId: string, input: ParsedCreateLeagueRequest, key: string) {
    return this.receipts.execute(actorAdminId, 'admin.league.create', key, async (transaction) => {
      const league = await transaction.league.create({
        data: {
          name: input.name,
          shortName: input.shortName,
          description: input.description,
          logoUrl: input.logoUrl,
          defaultPlatform: input.defaultPlatform,
          defaultServerRegion: input.defaultServerRegion,
          defaultSuperCapacity: input.defaultSuperCapacity,
          defaultChampionCapacity: input.defaultChampionCapacity,
          defaultPromotionCount: input.defaultPromotionCount,
          createdByAdminId: actorAdminId
        }
      });
      await this.audit.record(transaction, {
        actorAdminId,
        leagueId: league.id,
        action: 'admin.league.create',
        resourceType: 'League',
        resourceId: league.id,
        metadata: { name: league.name, shortName: league.shortName }
      });
      return this.detail(league);
    });
  }

  update(actorAdminId: string, leagueId: string, input: UpdateLeagueRequest, key: string) {
    return this.receipts.execute(actorAdminId, `admin.league.update:${leagueId}`, key, async (transaction) => {
      const result = await transaction.league.updateMany({
        where: { id: leagueId, version: input.expectedVersion },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.defaultPlatform !== undefined ? { defaultPlatform: input.defaultPlatform } : {}),
          ...(input.defaultServerRegion !== undefined ? { defaultServerRegion: input.defaultServerRegion } : {}),
          ...(input.defaultSuperCapacity !== undefined ? { defaultSuperCapacity: input.defaultSuperCapacity } : {}),
          ...(input.defaultChampionCapacity !== undefined ? { defaultChampionCapacity: input.defaultChampionCapacity } : {}),
          ...(input.defaultPromotionCount !== undefined ? { defaultPromotionCount: input.defaultPromotionCount } : {}),
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw new AdminError('VERSION_CONFLICT', 'League has changed', 409);
      const league = await transaction.league.findUniqueOrThrow({ where: { id: leagueId } });
      await this.audit.record(transaction, {
        actorAdminId,
        leagueId,
        action: 'admin.league.update',
        resourceType: 'League',
        resourceId: leagueId,
        metadata: Object.fromEntries(
          Object.entries(input).filter(([keyName]) => keyName !== 'expectedVersion')
        )
      });
      return this.detail(league);
    });
  }

  private detail(league: League) {
    return {
      id: league.id,
      name: league.name,
      shortName: league.shortName,
      description: league.description,
      logoUrl: league.logoUrl,
      status: league.status,
      defaultPlatform: league.defaultPlatform,
      defaultServerRegion: league.defaultServerRegion,
      defaultSuperCapacity: league.defaultSuperCapacity,
      defaultChampionCapacity: league.defaultChampionCapacity,
      defaultPromotionCount: league.defaultPromotionCount,
      featuredSeason: null,
      version: league.version,
      createdAt: league.createdAt.toISOString(),
      updatedAt: league.updatedAt.toISOString(),
      capabilities: { canManage: true, canCreateSeason: true }
    };
  }
}
