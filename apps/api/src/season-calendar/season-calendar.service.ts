import { Inject, Injectable, Optional } from '@nestjs/common';
import type { SeasonAgendaItem, SeasonAgendaResponse } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { LeagueError } from '../leagues/league.errors.js';

@Injectable()
export class SeasonCalendarService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async list(userId: string, leagueId: string, seasonId: string, month: string, now = new Date()): Promise<SeasonAgendaResponse> {
    const visibleLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    if (visibleLeagueId !== leagueId) throw this.visibility.notFound();
    const entry = await this.prisma.seasonEntry.findFirst({
      where: { seasonId, ownerUserId: userId, status: 'APPROVED', leagueTeam: { status: 'ACTIVE' } },
      select: { id: true }
    });
    if (!entry) throw new LeagueError('LEAGUE_PARTICIPANT_REQUIRED', 'An approved season entry is required', 403);

    const [year, monthNumber] = month.split('-').map(Number);
    if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
      throw new LeagueError('INVALID_AGENDA_MONTH', 'Month must be YYYY-MM', 400);
    }
    const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1));
    const monthEnd = new Date(Date.UTC(year, monthNumber, 1));
    const [fixtures, transfers, valuations] = await Promise.all([
      this.prisma.competitionMatch.findMany({
        where: {
          stage: { status: 'PUBLISHED', competition: { seasonId } },
          plannedAt: { gte: monthStart, lt: monthEnd }
        },
        select: {
          id: true, plannedAt: true, officialResultVersionId: true,
          homeParticipant: { select: { displayNameSnapshot: true } },
          awayParticipant: { select: { displayNameSnapshot: true } }
        }
      }),
      this.prisma.transferWindow.findMany({
        where: { seasonId, startsAt: { lt: monthEnd }, endsAt: { gt: monthStart } },
        select: { id: true, name: true, startsAt: true, endsAt: true }
      }),
      this.prisma.valuationWindow.findMany({
        where: { seasonId, startsAt: { lt: monthEnd }, endsAt: { gt: monthStart } },
        select: { id: true, name: true, startsAt: true, endsAt: true, closedAt: true }
      })
    ]);
    const items: SeasonAgendaItem[] = [
      ...fixtures.filter((fixture) => fixture.plannedAt !== null).map((fixture) => {
        const startsAt = fixture.plannedAt!;
        const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60_000);
        return {
          id: fixture.id, kind: 'FIXTURE' as const,
          title: `${fixture.homeParticipant.displayNameSnapshot} vs ${fixture.awayParticipant.displayNameSnapshot}`,
          startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
          status: fixture.officialResultVersionId ? 'ENDED' as const : this.status(startsAt, endsAt, now),
          targetPath: `/pages/my-matches/index?leagueId=${encodeURIComponent(leagueId)}&seasonId=${encodeURIComponent(seasonId)}`
        };
      }),
      ...transfers.map((window) => ({
        id: window.id, kind: 'TRANSFER' as const, title: window.name,
        startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString(),
        status: this.status(window.startsAt, window.endsAt, now), targetPath: null
      })),
      ...valuations.map((window) => {
        const endsAt = window.closedAt && window.closedAt < window.endsAt ? window.closedAt : window.endsAt;
        return {
          id: window.id, kind: 'VALUATION' as const, title: window.name,
          startsAt: window.startsAt.toISOString(), endsAt: endsAt.toISOString(),
          status: this.status(window.startsAt, endsAt, now), targetPath: null
        };
      })
    ];
    items.sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
    return { month, items };
  }

  private status(startsAt: Date, endsAt: Date, now: Date): SeasonAgendaItem['status'] {
    return now < startsAt ? 'UPCOMING' : now >= endsAt ? 'ENDED' : 'ACTIVE';
  }
}
