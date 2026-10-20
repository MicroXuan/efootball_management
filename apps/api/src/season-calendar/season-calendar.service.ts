import { Inject, Injectable, Optional } from '@nestjs/common';
import type { SeasonAgendaItem, SeasonAgendaResponse } from '@efm/contracts';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { LeagueError } from '../leagues/league.errors.js';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingDate(value: Date): string {
  return new Date(value.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function dateColumn(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function monthBounds(month: string): { firstDate: string; lastDate: string; start: Date; end: Date } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new LeagueError('INVALID_AGENDA_MONTH', 'Month must be YYYY-MM', 400);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const firstDate = new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
  const lastDate = new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
  return {
    firstDate, lastDate,
    start: new Date(Date.UTC(year, monthIndex, 1) - BEIJING_OFFSET_MS),
    end: new Date(Date.UTC(year, monthIndex + 1, 1) - BEIJING_OFFSET_MS)
  };
}

function phaseItem(
  id: string, kind: 'TRANSFER' | 'FORCED_OFFER' | 'VALUATION' | 'NOMINATION',
  title: string, startsAt: Date, endsAt: Date, now: Date, targetPath: string | null = null
): SeasonAgendaItem {
  return {
    id, kind, noteKind: null, title, description: null, version: null,
    firstDate: beijingDate(startsAt), lastDate: beijingDate(new Date(endsAt.getTime() - 1)),
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    status: now < startsAt ? 'UPCOMING' : now >= endsAt ? 'ENDED' : 'ACTIVE',
    targetPath
  };
}

@Injectable()
export class SeasonCalendarService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService,
    @Optional() @Inject(AdminAuthorizationService) private readonly authorization?: AdminAuthorizationService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async listForUser(userId: string, leagueId: string, seasonId: string, month: string, now = new Date()): Promise<SeasonAgendaResponse> {
    const visibleLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    if (visibleLeagueId !== leagueId) throw this.visibility.notFound();
    const league = await this.prisma.league.findUnique({ where: { id: leagueId }, select: { currentSeasonId: true, isDeleted: true } });
    if (!league || league.isDeleted) throw this.visibility.notFound();
    if (!league.currentSeasonId) return { month, seasonId: null, timezone: 'Asia/Shanghai', items: [] };
    if (league.currentSeasonId !== seasonId) throw this.visibility.notFound();
    return this.aggregate(leagueId, seasonId, month, now);
  }

  async listForAdmin(adminId: string, leagueId: string, month: string, now = new Date()): Promise<SeasonAgendaResponse> {
    if (!this.authorization) throw new Error('Admin authorization is required');
    await this.authorization.requireLeagueManager(adminId, leagueId);
    const league = await this.prisma.league.findUnique({ where: { id: leagueId }, select: { currentSeasonId: true, isDeleted: true } });
    if (!league || league.isDeleted) throw this.visibility.notFound();
    if (!league.currentSeasonId) return { month, seasonId: null, timezone: 'Asia/Shanghai', items: [] };
    return this.aggregate(leagueId, league.currentSeasonId, month, now);
  }

  private async aggregate(leagueId: string, seasonId: string, month: string, now: Date): Promise<SeasonAgendaResponse> {
    const bounds = monthBounds(month);
    const [transfers, forcedOffers, valuations, nominations, notes] = await Promise.all([
      this.prisma.transferWindow.findMany({
        where: { seasonId, startsAt: { lt: bounds.end }, endsAt: { gt: bounds.start } },
        select: { id: true, name: true, startsAt: true, endsAt: true }
      }),
      this.prisma.forcedOfferWindow.findMany({
        where: { seasonId, startsAt: { lt: bounds.end }, endsAt: { gt: bounds.start } },
        select: { id: true, name: true, startsAt: true, endsAt: true }
      }),
      this.prisma.valuationWindow.findMany({
        where: { seasonId, startsAt: { lt: bounds.end }, endsAt: { gt: bounds.start } },
        select: { id: true, name: true, startsAt: true, endsAt: true, closedAt: true }
      }),
      this.prisma.nominationWindow.findMany({
        where: { seasonId, startsAt: { lt: bounds.end }, endsAt: { gt: bounds.start } },
        select: { id: true, startsAt: true, endsAt: true }
      }),
      this.prisma.seasonCalendarNote.findMany({
        where: { seasonId, deletedAt: null, startsOn: { lte: new Date(`${bounds.lastDate}T00:00:00.000Z`) },
          endsOn: { gte: new Date(`${bounds.firstDate}T00:00:00.000Z`) } },
        select: { id: true, kind: true, title: true, description: true, startsOn: true, endsOn: true, version: true }
      })
    ]);
    const overlapsMonth = (start: Date, end: Date) => end > bounds.start && start < bounds.end && end > start;
    const items: SeasonAgendaItem[] = [
      ...transfers.filter((row) => overlapsMonth(row.startsAt, row.endsAt))
        .map((row) => phaseItem(row.id, 'TRANSFER', row.name, row.startsAt, row.endsAt, now)),
      ...forcedOffers.filter((row) => overlapsMonth(row.startsAt, row.endsAt))
        .map((row) => phaseItem(row.id, 'FORCED_OFFER', row.name, row.startsAt, row.endsAt, now)),
      ...valuations.filter((row) => overlapsMonth(row.startsAt, row.closedAt && row.closedAt < row.endsAt ? row.closedAt : row.endsAt))
        .map((row) => phaseItem(row.id, 'VALUATION', row.name, row.startsAt,
          row.closedAt && row.closedAt < row.endsAt ? row.closedAt : row.endsAt, now)),
      ...nominations.filter((row) => overlapsMonth(row.startsAt, row.endsAt))
        .map((row) => phaseItem(row.id, 'NOMINATION', '球员提名期', row.startsAt, row.endsAt, now,
          `/pages/player-nominations/index?leagueId=${encodeURIComponent(leagueId)}&seasonId=${encodeURIComponent(seasonId)}&windowId=${encodeURIComponent(row.id)}`)),
      ...notes.filter((row) => dateColumn(row.startsOn) <= bounds.lastDate && dateColumn(row.endsOn) >= bounds.firstDate)
        .map((row): SeasonAgendaItem => {
          const firstDate = dateColumn(row.startsOn);
          const lastDate = dateColumn(row.endsOn);
          const today = beijingDate(now);
          return {
            id: row.id, kind: 'MANUAL', noteKind: row.kind, title: row.title, description: row.description, version: row.version,
            firstDate, lastDate, startsAt: null, endsAt: null,
            status: today < firstDate ? 'UPCOMING' : today > lastDate ? 'ENDED' : 'ACTIVE',
            targetPath: null
          };
        })
    ];
    items.sort((left, right) => left.firstDate.localeCompare(right.firstDate)
      || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
    return { month, seasonId, timezone: 'Asia/Shanghai', items };
  }
}
