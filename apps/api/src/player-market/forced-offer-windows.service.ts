import { Inject, Injectable } from '@nestjs/common';
import {
  CreateForcedOfferWindowRequestSchema,
  UpdateForcedOfferWindowRequestSchema,
  type CreateForcedOfferWindowRequest,
  type ForcedOfferWindow,
  type ForcedOfferWindowListResponse,
  type UpdateForcedOfferWindowRequest,
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type ForcedOfferWindow as WindowRow } from '../generated/prisma/client.js';
import { playerMarketError } from './player-market.errors.js';

@Injectable()
export class ForcedOfferWindowsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService,
  ) {}

  async list(adminId: string, leagueId: string, seasonId: string): Promise<ForcedOfferWindowListResponse> {
    await this.authorization.requireLeagueManager(adminId, leagueId);
    await this.requireSeason(leagueId, seasonId);
    const rows = await this.prisma.forcedOfferWindow.findMany({
      where: { seasonId }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    return { items: rows.map((row) => this.view(row)) };
  }

  async create(adminId: string, leagueId: string, seasonId: string, raw: CreateForcedOfferWindowRequest, key: string): Promise<ForcedOfferWindow> {
    const input = this.parseCreate(raw);
    await this.authorization.requireLeagueManager(adminId, leagueId);
    await this.requireSeason(leagueId, seasonId);
    return this.receipts.execute(adminId, `FORCED_OFFER_WINDOW_CREATE:${seasonId}`, key, async (tx) => {
      await this.lockSeason(tx, seasonId);
      await this.rejectOverlap(tx, seasonId, new Date(input.startsAt), new Date(input.endsAt));
      const created = await tx.forcedOfferWindow.create({
        data: { seasonId, createdByAdminId: adminId, name: input.name, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) },
      });
      await this.audit.record(tx, {
        actorAdminId: adminId, leagueId, action: 'FORCED_OFFER_WINDOW_CREATED',
        resourceType: 'FORCED_OFFER_WINDOW', resourceId: created.id,
        metadata: { seasonId, startsAt: input.startsAt, endsAt: input.endsAt },
      });
      return this.view(created);
    });
  }

  async update(adminId: string, leagueId: string, seasonId: string, windowId: string, raw: UpdateForcedOfferWindowRequest, key: string): Promise<ForcedOfferWindow> {
    const input = this.parseUpdate(raw);
    await this.authorization.requireLeagueManager(adminId, leagueId);
    await this.requireSeason(leagueId, seasonId);
    return this.receipts.execute(adminId, `FORCED_OFFER_WINDOW_UPDATE:${windowId}`, key, async (tx) => {
      await this.lockSeason(tx, seasonId);
      const current = await tx.forcedOfferWindow.findUnique({ where: { id: windowId } });
      if (!current || current.seasonId !== seasonId) throw playerMarketError('FORCED_OFFER_WINDOW_NOT_FOUND', '强报期不存在', 404);
      if (current.version !== input.expectedVersion) throw playerMarketError('VERSION_CONFLICT', '强报期已被其他管理员修改', 409, { currentVersion: current.version });
      const start = new Date(input.startsAt);
      const end = new Date(input.endsAt);
      if (current.startsAt <= new Date() && start.getTime() !== current.startsAt.getTime()) {
        throw playerMarketError('FORCED_OFFER_WINDOW_LOCKED', '强报期开始后不能修改开始时间');
      }
      if (end < current.endsAt && await tx.playerAcquisitionApplication.count({ where: { forcedOfferWindowId: windowId } }) > 0) {
        throw playerMarketError('FORCED_OFFER_WINDOW_LOCKED', '已有申请的强报期不能提前截止');
      }
      await this.rejectOverlap(tx, seasonId, start, end, windowId);
      const updated = await tx.forcedOfferWindow.update({
        where: { id: windowId }, data: { name: input.name, startsAt: start, endsAt: end, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        actorAdminId: adminId, leagueId, action: 'FORCED_OFFER_WINDOW_UPDATED',
        resourceType: 'FORCED_OFFER_WINDOW', resourceId: windowId,
        metadata: { seasonId, version: updated.version, startsAt: input.startsAt, endsAt: input.endsAt },
      });
      return this.view(updated);
    });
  }

  private parseCreate(raw: CreateForcedOfferWindowRequest) {
    const parsed = CreateForcedOfferWindowRequestSchema.safeParse(raw);
    if (!parsed.success) throw playerMarketError(
      parsed.error.issues.some((issue) => issue.path.includes('endsAt')) ? 'FORCED_OFFER_WINDOW_INVALID_DATES' : 'FORCED_OFFER_WINDOW_INVALID_INPUT',
      '强报期名称或时间无效', 400,
    );
    return parsed.data;
  }

  private parseUpdate(raw: UpdateForcedOfferWindowRequest) {
    const parsed = UpdateForcedOfferWindowRequestSchema.safeParse(raw);
    if (!parsed.success) throw playerMarketError(
      parsed.error.issues.some((issue) => issue.path.includes('endsAt')) ? 'FORCED_OFFER_WINDOW_INVALID_DATES' : 'FORCED_OFFER_WINDOW_INVALID_INPUT',
      '强报期名称、时间或版本无效', 400,
    );
    return parsed.data;
  }

  private async requireSeason(leagueId: string, seasonId: string) {
    const season = await this.prisma.leagueSeason.findFirst({ where: { id: seasonId, leagueId, league: { isDeleted: false } }, select: { id: true } });
    if (!season) throw playerMarketError('SEASON_NOT_FOUND', '赛季不属于当前联赛', 404);
  }

  private lockSeason(tx: Prisma.TransactionClient, seasonId: string) {
    return tx.$queryRaw(Prisma.sql`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`);
  }

  private async rejectOverlap(tx: Prisma.TransactionClient, seasonId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
    const overlap = await tx.forcedOfferWindow.findFirst({
      where: { seasonId, ...(excludeId ? { id: { not: excludeId } } : {}), startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      select: { id: true },
    });
    if (overlap) throw playerMarketError('FORCED_OFFER_WINDOW_OVERLAP', '强报期与已有时间段重叠', 409, { conflictingWindowId: overlap.id });
  }

  private view(row: WindowRow): ForcedOfferWindow {
    const now = new Date();
    return {
      id: row.id, seasonId: row.seasonId, createdByAdminId: row.createdByAdminId,
      name: row.name, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(),
      status: now < row.startsAt ? 'UPCOMING' : now < row.endsAt ? 'OPEN' : 'CLOSED',
      version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }
}
