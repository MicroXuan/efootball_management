import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';
import { playerMarketError } from './player-market.errors.js';

export type ParticipantScope = {
  seasonEntryId: string;
  leagueId: string;
  seasonId: string;
  leagueTeamId: string;
  teamNumber: number | null;
  teamName: string;
  teamLogoUrl: string | null;
  ownerAlias: string;
  rosterStatus: 'COMPLIANT' | 'OVER_CAP';
};

export type OwnedTeamScope = ParticipantScope;

@Injectable()
export class PlayerMarketAccessService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async requireParticipant(userId: string, leagueId: string, seasonId: string): Promise<ParticipantScope> {
    const actualLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    if (actualLeagueId !== leagueId) {
      throw playerMarketError('PLAYER_MARKET_SCOPE_MISMATCH', '赛季不属于当前联赛', 404);
    }
    const entry = await this.prisma.seasonEntry.findFirst({
      where: {
        ownerUserId: userId,
        seasonId,
        status: 'APPROVED',
        leagueTeam: { leagueId, status: 'ACTIVE' }
      },
      select: {
        id: true,
        seasonId: true,
        leagueTeamId: true,
        leagueTeam: {
          select: {
            id: true,
            leagueId: true,
            teamNumber: true,
            name: true,
            logoUrl: true,
            ownerAlias: true,
            rosterStatus: true
          }
        }
      }
    });
    if (!entry) {
      throw playerMarketError('LEAGUE_PARTICIPANT_REQUIRED', '只有本赛季参赛球队可以访问球员市场', 403);
    }
    return {
      seasonEntryId: entry.id,
      leagueId: entry.leagueTeam.leagueId,
      seasonId: entry.seasonId,
      leagueTeamId: entry.leagueTeamId,
      teamNumber: entry.leagueTeam.teamNumber,
      teamName: entry.leagueTeam.name,
      teamLogoUrl: entry.leagueTeam.logoUrl,
      ownerAlias: entry.leagueTeam.ownerAlias,
      rosterStatus: entry.leagueTeam.rosterStatus
    };
  }

  async requireOwnedTeam(userId: string, leagueTeamId: string, seasonId: string): Promise<OwnedTeamScope> {
    const leagueId = await this.visibility.requireVisible({ type: 'TEAM', id: leagueTeamId });
    if (!leagueId) throw playerMarketError('LEAGUE_NOT_FOUND', '联赛不存在', 404);
    const scope = await this.requireParticipant(userId, leagueId, seasonId);
    if (scope.leagueTeamId !== leagueTeamId) {
      throw playerMarketError('PLAYER_MARKET_TEAM_OWNER_REQUIRED', '只能操作自己的参赛球队', 403);
    }
    return scope;
  }
}
