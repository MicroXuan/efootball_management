import { Inject, Injectable } from '@nestjs/common';
import {
  CreateNominationWindowRequestSchema, UpdateNominationWindowRequestSchema,
  type CreateNominationWindowRequest, type UpdateNominationWindowRequest, type NominationWindow
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminError } from '../admin/admin.errors.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { NominationWindow as DbNominationWindow } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class NominationWindowService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService
  ) {}

  isOpen(window: Pick<NominationWindow, 'startsAt' | 'endsAt'>, at = new Date()) {
    return new Date(window.startsAt) <= at && at < new Date(window.endsAt);
  }

  async list(adminId: string, leagueId: string, seasonId: string) {
    await this.requireSeason(adminId, leagueId, seasonId);
    const windows = await this.prisma.nominationWindow.findMany({
      where: { seasonId }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }]
    });
    return { items: windows.map((window) => this.present(window, leagueId)) };
  }

  async create(adminId: string, leagueId: string, seasonId: string, raw: CreateNominationWindowRequest, key: string): Promise<NominationWindow> {
    await this.requireSeason(adminId, leagueId, seasonId);
    const input = CreateNominationWindowRequestSchema.parse(raw);
    return this.receipts.execute(adminId, `NOMINATION_WINDOW_CREATE:${seasonId}`, key, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`);
      await this.requireNoOverlap(tx, seasonId, new Date(input.startsAt), new Date(input.endsAt));
      const window = await tx.nominationWindow.create({
        data: { seasonId, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), perTeamLimit: input.perTeamLimit, createdByAdminId: adminId }
      });
      await this.audit.record(tx, {
        actorAdminId: adminId, leagueId, action: 'NOMINATION_WINDOW_CREATED',
        resourceType: 'NominationWindow', resourceId: window.id, metadata: { seasonId, perTeamLimit: window.perTeamLimit }
      });
      return this.present(window, leagueId);
    }, input);
  }

  async update(adminId: string, leagueId: string, seasonId: string, windowId: string, raw: UpdateNominationWindowRequest, key: string): Promise<NominationWindow> {
    await this.requireSeason(adminId, leagueId, seasonId);
    const input = UpdateNominationWindowRequestSchema.parse(raw);
    return this.receipts.execute(adminId, `NOMINATION_WINDOW_UPDATE:${windowId}`, key, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`);
      const current = await tx.nominationWindow.findUniqueOrThrow({ where: { id: windowId } });
      if (current.seasonId !== seasonId) throw new AdminError('NOMINATION_WINDOW_NOT_FOUND', '提名期不存在', 404);
      if (current.version !== input.expectedVersion) throw new AdminError('NOMINATION_WINDOW_VERSION_CONFLICT', '提名期已被修改，请刷新', 409);
      const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
      if (startsAt >= endsAt) throw new AdminError('NOMINATION_WINDOW_TIMELINE_INVALID', '结束时间必须晚于开始时间', 400);
      await this.requireNoOverlap(tx, seasonId, startsAt, endsAt, windowId);
      const window = await tx.nominationWindow.update({
        where: { id: windowId },
        data: { startsAt, endsAt, ...(input.perTeamLimit !== undefined ? { perTeamLimit: input.perTeamLimit } : {}), version: { increment: 1 } }
      });
      await this.audit.record(tx, {
        actorAdminId: adminId, leagueId, action: 'NOMINATION_WINDOW_UPDATED',
        resourceType: 'NominationWindow', resourceId: window.id, metadata: { seasonId, version: window.version, perTeamLimit: window.perTeamLimit }
      });
      return this.present(window, leagueId);
    }, input);
  }

  private async requireSeason(adminId: string, leagueId: string, seasonId: string) {
    const season = await this.prisma.leagueSeason.findFirst({ where: { id: seasonId, leagueId }, select: { id: true } });
    if (!season) throw new AdminError('SEASON_NOT_FOUND', '赛季不存在', 404);
    await this.authorization.requireLeagueManager(adminId, leagueId);
  }

  private async requireNoOverlap(tx: Prisma.TransactionClient, seasonId: string, startsAt: Date, endsAt: Date, excludeId?: string) {
    const collisions = await tx.nominationWindow.findMany({
      where: { seasonId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true }
    });
    if (collisions.length) throw new AdminError('NOMINATION_WINDOW_OVERLAP', '提名期时间不能重叠', 409);
  }

  private present(window: DbNominationWindow, leagueId: string): NominationWindow {
    return {
      id: window.id, leagueId, seasonId: window.seasonId,
      startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString(),
      perTeamLimit: window.perTeamLimit, version: window.version
    };
  }
}
