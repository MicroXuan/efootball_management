import { Inject, Injectable, Optional } from '@nestjs/common';
import type { LeagueWorkspaceResponse } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from '../leagues/league.errors.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

@Injectable()
export class LeagueWorkspaceService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async get(userId: string, leagueId: string, seasonId: string): Promise<LeagueWorkspaceResponse> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const seasonLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    if (seasonLeagueId !== leagueId) throw this.visibility.notFound();
    const entry = await this.prisma.seasonEntry.findFirst({
      where: {
        ownerUserId: userId,
        seasonId,
        status: 'APPROVED',
        leagueTeam: { status: 'ACTIVE' },
        season: { leagueId, league: { isDeleted: false } }
      },
      include: {
        competitionParticipants: {
          where: { competition: { competitionType: 'DIVISION_LEAGUE' } },
          take: 1,
          include: {
            competition: { select: { competitionType: true } },
            stageMemberships: { include: { stage: true }, orderBy: { seed: 'asc' } }
          }
        }
      }
    });
    if (!entry) {
      throw new LeagueError('LEAGUE_WORKSPACE_FORBIDDEN', '只有当前赛季正式参赛球队可以查看联赛工作台', 403);
    }

    const participant = entry.competitionParticipants.find(
      ({ competition }) => competition.competitionType === 'DIVISION_LEAGUE'
    );
    const stage = participant?.stageMemberships[0]?.stage ?? null;
    const now = new Date();
    const [snapshot, valuationWindow] = await Promise.all([
      stage && participant ? this.prisma.standingsSnapshot.findFirst({
        where: { stageId: stage.id },
        orderBy: { version: 'desc' },
        include: { rows: { where: { participantId: participant.id }, take: 1 } }
      }) : Promise.resolve(null),
      this.prisma.valuationWindow.findFirst({
        where: {
          seasonId,
          startsAt: { lte: now },
          endsAt: { gt: now },
          closedAt: null
        },
        select: { id: true }
      })
    ]);
    const rank = snapshot?.rows[0] ?? null;
    return {
      leagueId,
      seasonId,
      team: {
        leagueTeamId: entry.leagueTeamId,
        name: entry.teamNameSnapshot,
        shortName: entry.teamShortNameSnapshot,
        logoUrl: entry.teamLogoUrlSnapshot
      },
      division: stage?.stageCode && stage.displayName ? {
        stageId: stage.id,
        stageCode: stage.stageCode,
        displayName: stage.displayName
      } : null,
      currentRank: rank ? {
        rank: rank.rank,
        points: rank.totalPoints,
        played: rank.played,
        tiePending: rank.tiePending
      } : null,
      capabilities: {
        canViewStandings: Boolean(stage),
        canViewAssets: true,
        canViewFinance: true,
        canManageValuations: Boolean(valuationWindow)
      }
    };
  }
}
