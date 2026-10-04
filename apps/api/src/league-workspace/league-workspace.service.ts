import { Inject, Injectable } from '@nestjs/common';
import type { LeagueWorkspaceResponse } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from '../leagues/league.errors.js';

@Injectable()
export class LeagueWorkspaceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(userId: string, leagueId: string, seasonId: string): Promise<LeagueWorkspaceResponse> {
    const entry = await this.prisma.seasonEntry.findFirst({
      where: { ownerUserId: userId, seasonId, status: 'APPROVED', season: { leagueId } },
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
    const [snapshot, matches, valuationWindow] = await Promise.all([
      stage && participant ? this.prisma.standingsSnapshot.findFirst({
        where: { stageId: stage.id },
        orderBy: { version: 'desc' },
        include: { rows: { where: { participantId: participant.id }, take: 1 } }
      }) : Promise.resolve(null),
      stage && participant ? this.prisma.competitionMatch.findMany({
        where: {
          stageId: stage.id,
          officialResultVersionId: null,
          status: { notIn: ['CONFIRMED', 'ADMIN_DECIDED'] },
          OR: [{ homeParticipantId: participant.id }, { awayParticipantId: participant.id }]
        },
        include: { homeParticipant: true, awayParticipant: true }
      }) : Promise.resolve([]),
      this.prisma.valuationWindow.findFirst({ where: { seasonId }, select: { id: true } })
    ]);
    const rank = snapshot?.rows[0] ?? null;
    matches.sort((left, right) => {
      const leftTime = left.plannedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.plannedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.roundNumber - right.roundNumber || left.matchNumber - right.matchNumber || left.id.localeCompare(right.id);
    });
    const next = matches[0] ?? null;
    const isHome = next?.homeParticipantId === participant?.id;

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
      nextMatch: next ? {
        id: next.id,
        roundNumber: next.roundNumber,
        plannedAt: next.plannedAt?.toISOString() ?? null,
        opponentName: isHome ? next.awayParticipant.displayNameSnapshot : next.homeParticipant.displayNameSnapshot,
        side: isHome ? 'HOME' : 'AWAY'
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
