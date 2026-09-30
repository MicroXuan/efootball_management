import { Inject, Injectable } from '@nestjs/common';
import type { ParsedCreateLeagueRequest, UpdateLeagueRequest } from '@efm/contracts';
import type { League, Prisma } from '../generated/prisma/client.js';
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

  async list() {
    const leagues = await this.prisma.league.findMany({
      include: {
        currentSeason: {
          include: { _count: { select: { entries: { where: { status: 'APPROVED' } } } } }
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
    });
    return { items: leagues.map((league) => this.detail(league)), nextCursor: null };
  }

  create(actorAdminId: string, input: ParsedCreateLeagueRequest, key: string) {
    return this.receipts.execute(actorAdminId, 'admin.league.create', key, async (transaction) => {
      const league = await transaction.league.create({
        data: {
          name: input.name,
          shortName: input.shortName,
          description: input.description,
          logoUrl: input.logoUrl,
          edition: input.edition,
          defaultPlatform: 'MOBILE',
          defaultServerRegion: this.legacyRegion(input.edition),
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
          ...(input.edition !== undefined ? {
            edition: input.edition,
            defaultServerRegion: this.legacyRegion(input.edition)
          } : {}),
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

  private detail(league: League & {
    currentSeason?: (Prisma.LeagueSeasonGetPayload<Record<string, never>> & {
      _count: { entries: number };
    }) | null;
  }) {
    return {
      id: league.id,
      name: league.name,
      shortName: league.shortName,
      description: league.description,
      logoUrl: league.logoUrl,
      status: league.status,
      edition: league.edition,
      defaultSuperCapacity: league.defaultSuperCapacity,
      defaultChampionCapacity: league.defaultChampionCapacity,
      defaultPromotionCount: league.defaultPromotionCount,
      currentSeason: league.currentSeason ? {
        id: league.currentSeason.id,
        displayName: league.currentSeason.displayName,
        status: league.currentSeason.status,
        approvedEntryCount: league.currentSeason._count.entries
      } : null,
      version: league.version,
      createdAt: league.createdAt.toISOString(),
      updatedAt: league.updatedAt.toISOString(),
      capabilities: { canManage: true, canCreateSeason: true }
    };
  }

  private legacyRegion(edition: 'NATIONAL' | 'INTERNATIONAL'): string {
    return edition === 'NATIONAL' ? 'CN' : 'GLOBAL';
  }
}
