import { Inject, Injectable } from '@nestjs/common';
import {
  CreateTransferWindowRequestSchema,
  UpdateTransferWindowRequestSchema,
  type CreateTransferWindowRequest,
  type TransferOperation,
  type UpdateTransferWindowRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LeagueRosterError } from './league-roster.errors.js';

const operationField: Record<TransferOperation, 'allowBuy' | 'allowSell' | 'allowTransfer' | 'allowCardUpgrade'> = {
  BUY: 'allowBuy',
  SELL: 'allowSell',
  TRANSFER: 'allowTransfer',
  CARD_UPGRADE: 'allowCardUpgrade'
};

@Injectable()
export class TransferWindowsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async create(adminId: string, seasonId: string, raw: CreateTransferWindowRequest) {
    const input = CreateTransferWindowRequestSchema.parse(raw);
    const season = await this.prisma.leagueSeason.findUniqueOrThrow({ where: { id: seasonId } });
    await this.authorization.requireLeagueManager(adminId, season.leagueId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`);
      await this.rejectOverlap(tx, seasonId, new Date(input.startsAt), new Date(input.endsAt));
      const created = await tx.transferWindow.create({
        data: {
          seasonId,
          createdByAdminId: adminId,
          ...input,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt)
        }
      });
      await this.audit.record(tx, {
        actorAdminId: adminId,
        leagueId: season.leagueId,
        action: 'TRANSFER_WINDOW_CREATED',
        resourceType: 'TRANSFER_WINDOW',
        resourceId: created.id,
        metadata: { seasonId, startsAt: input.startsAt, endsAt: input.endsAt }
      });
      return created;
    });
  }

  async update(adminId: string, windowId: string, raw: UpdateTransferWindowRequest) {
    const input = UpdateTransferWindowRequestSchema.parse(raw);
    const current = await this.prisma.transferWindow.findUniqueOrThrow({
      where: { id: windowId },
      include: { season: true }
    });
    await this.authorization.requireLeagueManager(adminId, current.season.leagueId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM transfer_windows WHERE id = ${windowId} FOR UPDATE`);
      const locked = await tx.transferWindow.findUniqueOrThrow({ where: { id: windowId } });
      if (locked.version !== input.expectedVersion) {
        throw new LeagueRosterError('VERSION_CONFLICT', 'Transfer window has changed', 409, {
          currentVersion: locked.version
        });
      }
      await this.rejectOverlap(
        tx,
        locked.seasonId,
        new Date(input.startsAt),
        new Date(input.endsAt),
        windowId
      );
      const updated = await tx.transferWindow.update({
        where: { id: windowId },
        data: {
          name: input.name,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          allowBuy: input.allowBuy,
          allowSell: input.allowSell,
          allowTransfer: input.allowTransfer,
          allowCardUpgrade: input.allowCardUpgrade,
          version: { increment: 1 }
        }
      });
      await this.audit.record(tx, {
        actorAdminId: adminId,
        leagueId: current.season.leagueId,
        action: 'TRANSFER_WINDOW_UPDATED',
        resourceType: 'TRANSFER_WINDOW',
        resourceId: windowId,
        metadata: { seasonId: locked.seasonId, version: updated.version }
      });
      return updated;
    });
  }

  async requireAllowed(seasonId: string, operation: TransferOperation, at = new Date()) {
    const windows = await this.prisma.transferWindow.findMany({
      where: { seasonId, startsAt: { lte: at }, endsAt: { gt: at } },
      orderBy: { startsAt: 'asc' }
    });
    if (windows.length === 0) {
      throw new LeagueRosterError('TRANSFER_WINDOW_CLOSED', 'No transfer window is open', 409);
    }
    const allowed = windows.find((window) => window[operationField[operation]]);
    if (!allowed) {
      throw new LeagueRosterError(
        'TRANSFER_OPERATION_NOT_ALLOWED',
        'The open transfer window does not allow this operation',
        409,
        { operation }
      );
    }
    return allowed;
  }

  private async rejectOverlap(
    client: Prisma.TransactionClient,
    seasonId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string
  ) {
    const overlap = await client.transferWindow.findFirst({
      where: {
        seasonId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt }
      }
    });
    if (overlap) {
      throw new LeagueRosterError('TRANSFER_WINDOW_OVERLAP', 'Transfer windows cannot overlap', 409, {
        conflictingWindowId: overlap.id
      });
    }
  }
}
