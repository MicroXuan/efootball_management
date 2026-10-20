import { Inject, Injectable } from '@nestjs/common';
import {
  CreateSeasonCalendarNoteRequestSchema, UpdateSeasonCalendarNoteRequestSchema,
  type CreateSeasonCalendarNoteRequest, type SeasonCalendarNote, type UpdateSeasonCalendarNoteRequest
} from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import { MutationReceiptService } from '../competitions/mutation-receipt.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { SeasonCalendarNote as NoteRow } from '../generated/prisma/client.js';
import { LeagueError } from '../leagues/league.errors.js';

const asDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

@Injectable()
export class SeasonCalendarNoteService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(MutationReceiptService) private readonly receipts: MutationReceiptService
  ) {}

  async create(
    adminId: string, leagueId: string, seasonId: string,
    raw: CreateSeasonCalendarNoteRequest, key: string
  ): Promise<SeasonCalendarNote> {
    const result = CreateSeasonCalendarNoteRequestSchema.safeParse(raw);
    if (!result.success) throw new LeagueError('CALENDAR_NOTE_INVALID', '日历事项日期或内容不合法', 400);
    const input = result.data;
    await this.requireScope(adminId, leagueId, seasonId);
    return this.receipts.execute(adminId, `CALENDAR_NOTE_CREATE:${seasonId}`, key, async (tx) => {
      const row = await tx.seasonCalendarNote.create({ data: {
        seasonId, kind: input.kind, title: input.title, description: input.description ?? null,
        startsOn: asDate(input.startsOn), endsOn: asDate(input.endsOn),
        createdByAdminId: adminId, updatedByAdminId: adminId
      } });
      await this.audit.record(tx, { actorAdminId: adminId, leagueId, action: 'CALENDAR_NOTE_CREATED',
        resourceType: 'SEASON_CALENDAR_NOTE', resourceId: row.id, metadata: { seasonId, kind: input.kind } });
      return this.view(row);
    });
  }

  async update(
    adminId: string, leagueId: string, seasonId: string, noteId: string,
    raw: UpdateSeasonCalendarNoteRequest, key: string
  ): Promise<SeasonCalendarNote> {
    const result = UpdateSeasonCalendarNoteRequestSchema.safeParse(raw);
    if (!result.success) throw new LeagueError('CALENDAR_NOTE_INVALID', '日历事项日期或内容不合法', 400);
    const input = result.data;
    await this.requireScope(adminId, leagueId, seasonId);
    return this.receipts.execute(adminId, `CALENDAR_NOTE_UPDATE:${noteId}`, key, async (tx) => {
      const current = await tx.seasonCalendarNote.findUnique({ where: { id: noteId } });
      this.assertCurrent(current, seasonId, input.expectedVersion);
      const changed = await tx.seasonCalendarNote.updateMany({
        where: { id: noteId, version: input.expectedVersion, deletedAt: null },
        data: { kind: input.kind, title: input.title, description: input.description ?? null,
          startsOn: asDate(input.startsOn), endsOn: asDate(input.endsOn),
          updatedByAdminId: adminId, version: { increment: 1 } }
      });
      if (changed.count !== 1) throw new LeagueError('VERSION_CONFLICT', '日历事项已被其他管理员修改', 409);
      const row = await tx.seasonCalendarNote.findUniqueOrThrow({ where: { id: noteId } });
      await this.audit.record(tx, { actorAdminId: adminId, leagueId, action: 'CALENDAR_NOTE_UPDATED',
        resourceType: 'SEASON_CALENDAR_NOTE', resourceId: noteId, metadata: { seasonId, previousVersion: current!.version } });
      return this.view(row);
    });
  }

  async remove(
    adminId: string, leagueId: string, seasonId: string, noteId: string,
    expectedVersion: number, key: string
  ): Promise<SeasonCalendarNote> {
    await this.requireScope(adminId, leagueId, seasonId);
    return this.receipts.execute(adminId, `CALENDAR_NOTE_REMOVE:${noteId}`, key, async (tx) => {
      const current = await tx.seasonCalendarNote.findUnique({ where: { id: noteId } });
      this.assertCurrent(current, seasonId, expectedVersion);
      const changed = await tx.seasonCalendarNote.updateMany({
        where: { id: noteId, version: expectedVersion, deletedAt: null },
        data: { deletedAt: new Date(), updatedByAdminId: adminId, version: { increment: 1 } }
      });
      if (changed.count !== 1) throw new LeagueError('VERSION_CONFLICT', '日历事项已被其他管理员修改', 409);
      const row = await tx.seasonCalendarNote.findUniqueOrThrow({ where: { id: noteId } });
      await this.audit.record(tx, { actorAdminId: adminId, leagueId, action: 'CALENDAR_NOTE_DELETED',
        resourceType: 'SEASON_CALENDAR_NOTE', resourceId: noteId, metadata: { seasonId, previousVersion: current!.version } });
      return this.view(row);
    });
  }

  private async requireScope(adminId: string, leagueId: string, seasonId: string): Promise<void> {
    await this.authorization.requireLeagueManager(adminId, leagueId);
    const season = await this.prisma.leagueSeason.findFirst({
      where: { id: seasonId, leagueId, league: { isDeleted: false } }, select: { id: true }
    });
    if (!season) throw new LeagueError('SEASON_NOT_FOUND', '赛季不存在', 404);
  }

  private assertCurrent(current: NoteRow | null, seasonId: string, version: number): void {
    if (!current || current.seasonId !== seasonId || current.deletedAt) {
      throw new LeagueError('CALENDAR_NOTE_NOT_FOUND', '日历事项不存在', 404);
    }
    if (current.version !== version) throw new LeagueError('VERSION_CONFLICT', '日历事项已被其他管理员修改', 409);
  }

  private view(row: NoteRow): SeasonCalendarNote {
    return {
      id: row.id, seasonId: row.seasonId, kind: row.kind, title: row.title, description: row.description,
      startsOn: row.startsOn.toISOString().slice(0, 10), endsOn: row.endsOn.toISOString().slice(0, 10),
      createdByAdminId: row.createdByAdminId, updatedByAdminId: row.updatedByAdminId,
      version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null
    };
  }
}
