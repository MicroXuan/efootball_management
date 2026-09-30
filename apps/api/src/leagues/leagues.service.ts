import { Inject, Injectable } from '@nestjs/common';
import type {
  LeagueDetail,
  LeagueListQuery,
  LeagueListResponse,
  LeagueSummary,
  ParsedCreateLeagueRequest,
  UpdateLeagueRequest
} from '@efm/contracts';
import type { League, LeagueSeason, Prisma } from '../generated/prisma/client.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from './league.errors.js';
import type { LeagueTransaction } from './league.types.js';

type SeasonWithCount = LeagueSeason & {
  _count: { entries: number };
  entries: Array<{ id: string }>;
};
const LEAGUE_INCLUDE = {
  currentSeason: {
    include: {
      _count: { select: { entries: true } },
      entries: { where: { status: 'APPROVED' }, select: { id: true } }
    }
  }
} satisfies Prisma.LeagueInclude;
type LeagueRecord = Prisma.LeagueGetPayload<{ include: typeof LEAGUE_INCLUDE }>;

@Injectable()
export class LeaguesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService
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
          edition: input.edition,
          defaultPlatform: 'MOBILE',
          defaultServerRegion: this.legacyRegion(input.edition),
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
          ...(input.edition !== undefined ? {
            edition: input.edition,
            defaultServerRegion: this.legacyRegion(input.edition)
          } : {}),
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

  async getPublic(leagueId: string, viewerId?: string): Promise<LeagueDetail> {
    const canManage = viewerId
      ? await this.authorization.can(viewerId, 'league.manage', { type: 'LEAGUE', id: leagueId })
      : false;
    return this.detail(await this.getRecord(this.prisma, leagueId), canManage);
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

  private summary(record: League & { currentSeason: SeasonWithCount | null }): LeagueSummary {
    return {
      id: record.id,
      name: record.name,
      shortName: record.shortName,
      description: record.description,
      logoUrl: record.logoUrl,
      status: record.status,
      edition: record.edition,
      defaultSuperCapacity: record.defaultSuperCapacity,
      defaultChampionCapacity: record.defaultChampionCapacity,
      defaultPromotionCount: record.defaultPromotionCount,
      currentSeason: record.currentSeason ? {
        id: record.currentSeason.id,
        displayName: record.currentSeason.displayName,
        status: record.currentSeason.status,
        approvedEntryCount: record.currentSeason.entries.length
      } : null,
      version: record.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
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

  private legacyRegion(edition: 'NATIONAL' | 'INTERNATIONAL'): string {
    return edition === 'NATIONAL' ? 'CN' : 'GLOBAL';
  }
}
