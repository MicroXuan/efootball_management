import { Inject, Injectable } from '@nestjs/common';
import type {
  LeagueDetail,
  LeagueListQuery,
  LeagueListResponse,
  LeagueSeasonSummary,
  LeagueSummary,
  ParsedCreateLeagueRequest,
  UpdateLeagueRequest
} from '@efm/contracts';
import type { League, LeagueSeason, Prisma } from '../generated/prisma/client.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from './league.errors.js';
import type { LeagueTransaction } from './league.types.js';

type SeasonWithCount = LeagueSeason & {
  _count: { entries: number };
  entries: Array<{ id: string }>;
};
const LEAGUE_INCLUDE = {
  seasons: {
    where: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
    include: {
      _count: { select: { entries: true } },
      entries: { where: { status: 'APPROVED' }, select: { id: true } }
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }]
  }
} satisfies Prisma.LeagueInclude;
type LeagueRecord = Prisma.LeagueGetPayload<{ include: typeof LEAGUE_INCLUDE }>;

@Injectable()
export class LeaguesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService
  ) {}

  create(
    actorId: string,
    input: ParsedCreateLeagueRequest,
    key: string
  ): Promise<LeagueDetail> {
    return this.receipts.execute(actorId, 'league.create', key, async (transaction) => {
      const managerRole = await transaction.role.findUnique({
        where: { code: 'LEAGUE_MANAGER' }
      });
      if (!managerRole) {
        throw new LeagueError('LEAGUE_ROLE_MISSING', 'League manager role is missing', 500);
      }
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
          createdById: actorId
        }
      });
      await transaction.userRoleBinding.create({
        data: {
          userId: actorId,
          roleId: managerRole.id,
          scopeType: 'LEAGUE',
          scopeId: league.id,
          grantedById: actorId
        }
      });
      return this.getRecord(transaction, league.id).then((record) => this.detail(record, true));
    });
  }

  update(
    actorId: string,
    leagueId: string,
    input: UpdateLeagueRequest,
    key: string
  ): Promise<LeagueDetail> {
    return this.receipts.execute(actorId, `league.update:${leagueId}`, key, async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`;
      const existing = await transaction.league.findUnique({ where: { id: leagueId } });
      if (!existing) throw this.notFound();
      const updated = await transaction.league.updateMany({
        where: { id: leagueId, version: input.expectedVersion },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.defaultPlatform !== undefined ? { defaultPlatform: input.defaultPlatform } : {}),
          ...(input.defaultServerRegion !== undefined
            ? { defaultServerRegion: input.defaultServerRegion }
            : {}),
          ...(input.defaultSuperCapacity !== undefined
            ? { defaultSuperCapacity: input.defaultSuperCapacity }
            : {}),
          ...(input.defaultChampionCapacity !== undefined
            ? { defaultChampionCapacity: input.defaultChampionCapacity }
            : {}),
          ...(input.defaultPromotionCount !== undefined
            ? { defaultPromotionCount: input.defaultPromotionCount }
            : {}),
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        throw new LeagueError('VERSION_CONFLICT', 'League has changed', 409);
      }
      return this.getRecord(transaction, leagueId).then((record) => this.detail(record, true));
    });
  }

  async listPublic(query: LeagueListQuery): Promise<LeagueListResponse> {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const records = await this.prisma.league.findMany({
      where: {
        status: 'ACTIVE',
        ...(cursor ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } }
          ]
        } : {})
      },
      include: LEAGUE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1
    });
    const page = records.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((record) => this.summary(record)),
      nextCursor: records.length > query.limit && last
        ? this.encodeCursor(last.createdAt, last.id)
        : null
    };
  }

  async getPublic(leagueId: string): Promise<LeagueDetail> {
    return this.detail(await this.getRecord(this.prisma, leagueId), false);
  }

  async getManaged(leagueId: string): Promise<LeagueDetail> {
    return this.detail(await this.getRecord(this.prisma, leagueId), true);
  }

  private async getRecord(
    client: LeagueTransaction | PrismaService,
    leagueId: string
  ): Promise<LeagueRecord> {
    const record = await client.league.findUnique({
      where: { id: leagueId },
      include: LEAGUE_INCLUDE
    });
    if (!record) throw this.notFound();
    return record;
  }

  private detail(record: LeagueRecord, canManage: boolean): LeagueDetail {
    return {
      ...this.summary(record),
      capabilities: { canManage, canCreateSeason: canManage }
    };
  }

  private summary(record: League & { seasons: SeasonWithCount[] }): LeagueSummary {
    return {
      id: record.id,
      name: record.name,
      shortName: record.shortName,
      description: record.description,
      logoUrl: record.logoUrl,
      status: record.status,
      defaultPlatform: record.defaultPlatform,
      defaultServerRegion: record.defaultServerRegion,
      defaultSuperCapacity: record.defaultSuperCapacity,
      defaultChampionCapacity: record.defaultChampionCapacity,
      defaultPromotionCount: record.defaultPromotionCount,
      featuredSeason: this.featuredSeason(record.seasons),
      version: record.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }

  private featuredSeason(seasons: SeasonWithCount[]): LeagueSeasonSummary | null {
    const priority = ['IN_PROGRESS', 'REGISTRATION_OPEN', 'ALLOCATION_REVIEW', 'READY', 'COMPLETED'];
    const selected = [...seasons].sort((left, right) => {
      const status = priority.indexOf(left.status) - priority.indexOf(right.status);
      return status || left.startsAt.getTime() - right.startsAt.getTime();
    })[0];
    return selected ? this.seasonSummary(selected) : null;
  }

  private seasonSummary(season: SeasonWithCount): LeagueSeasonSummary {
    return {
      id: season.id,
      leagueId: season.leagueId,
      seasonNumber: season.seasonNumber,
      displayName: season.displayName,
      previousSeasonId: season.previousSeasonId,
      isFirstSeason: season.isFirstSeason,
      registrationOpensAt: season.registrationOpensAt.toISOString(),
      registrationClosesAt: season.registrationClosesAt.toISOString(),
      startsAt: season.startsAt.toISOString(),
      endsAt: season.endsAt.toISOString(),
      superCapacity: season.superCapacity,
      championCapacity: season.championCapacity,
      promotionCount: season.promotionCount,
      status: season.status,
      entryCount: season._count.entries,
      approvedEntryCount: season.entries.length,
      version: season.version,
      createdAt: season.createdAt.toISOString(),
      updatedAt: season.updatedAt.toISOString()
    };
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
  }

  private decodeCursor(value: string): { createdAt: Date; id: string } {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
        createdAt?: unknown;
        id?: unknown;
      };
      if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error();
      const createdAt = new Date(parsed.createdAt);
      if (Number.isNaN(createdAt.getTime())) throw new Error();
      return { createdAt, id: parsed.id };
    } catch {
      throw new LeagueError('INVALID_CURSOR', 'League cursor is invalid', 400);
    }
  }

  private notFound(): LeagueError {
    return new LeagueError('LEAGUE_NOT_FOUND', 'League was not found', 404);
  }
}
