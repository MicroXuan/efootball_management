import { Inject, Injectable } from '@nestjs/common';
import type { PlayerValuationHistoryResponse, TeamAssetOverview } from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueError } from '../leagues/league.errors.js';

@Injectable()
export class TeamAssetsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getTeamAssets(userId: string, teamId: string): Promise<TeamAssetOverview> {
    const team = await this.prisma.leagueTeam.findUnique({
      where: { id: teamId },
      include: { owner: { select: { displayName: true, publicUserNo: true, avatarUrl: true } } }
    });
    if (!team) throw this.error('LEAGUE_TEAM_NOT_FOUND', '球队不存在', 404);
    if (team.ownerUserId !== userId) {
      throw this.error('TEAM_ASSET_OWNER_REQUIRED', '只有球队拥有者可以查看球队资产', 403);
    }
    if (!team.owner.publicUserNo) {
      throw this.error('PUBLIC_USER_NUMBER_MISSING', '球队拥有者尚未分配公开编号', 409);
    }
    const entry = await this.prisma.seasonEntry.findFirst({
      where: { leagueTeamId: teamId, ownerUserId: userId, status: 'APPROVED' },
      select: { id: true }
    });
    if (!entry) {
      throw this.error('TEAM_ASSET_SEASON_ENTRY_REQUIRED', '球队尚未获得联赛参赛资格', 403);
    }

    const ownerships = await this.prisma.leaguePlayerOwnership.findMany({
      where: { leagueTeamId: teamId, status: { in: ['ACTIVE', 'DISAPPEARED', 'RETIRED'] } },
      include: {
        footballPlayer: true,
        currentPlayerCard: { include: { attributes: true } }
      },
      orderBy: [{ acquiredAt: 'asc' }, { id: 'asc' }]
    });
    const active = ownerships.filter(({ status }) => status === 'ACTIVE');
    const valuations = await this.prisma.leaguePlayerValuation.findMany({
      where: {
        leagueId: team.leagueId,
        footballPlayerId: { in: ownerships.map(({ footballPlayerId }) => footballPlayerId) }
      }
    });
    const valuationByPlayer = new Map(valuations.map((valuation) => [valuation.footballPlayerId, valuation]));
    const knownPlayerValueMinor = active.reduce(
      (total, ownership) => total + (valuationByPlayer.get(ownership.footballPlayerId)?.currentValueMinor ?? 0),
      0
    );
    const missingValuationCount = active.filter(
      (ownership) => !valuationByPlayer.has(ownership.footballPlayerId)
    ).length;

    return {
      leagueId: team.leagueId,
      teamId: team.id,
      teamName: team.name,
      teamNumber: team.teamNumber,
      teamLogoUrl: team.logoUrl,
      ownerDisplayName: team.owner.displayName,
      ownerPublicUserNo: team.owner.publicUserNo,
      ownerAvatarUrl: team.owner.avatarUrl,
      shellValueMinor: team.shellValueMinor,
      knownPlayerValueMinor,
      totalKnownValueMinor: team.shellValueMinor + knownPlayerValueMinor,
      valuationCompleteness: missingValuationCount === 0 ? 'COMPLETE' : 'INCOMPLETE',
      missingValuationCount,
      activePlayerCount: active.length,
      activeSalaryMinor: active.reduce((total, ownership) => total + ownership.salaryMinor, 0),
      players: ownerships.map((ownership) => {
        const attributes = this.attributes(ownership.currentPlayerCard.attributes?.attributesJson);
        const valuation = valuationByPlayer.get(ownership.footballPlayerId);
        return {
          playerId: ownership.footballPlayerId,
          playerName: ownership.footballPlayer.nameZh
            ?? ownership.footballPlayer.nameEn
            ?? ownership.footballPlayer.shortName
            ?? '未命名球员',
          cardName: ownership.currentPlayerCard.cardName,
          cardImageUrl: ownership.currentPlayerCard.imageUrl,
          position: ownership.currentPlayerCard.position ?? null,
          nationality: ownership.footballPlayer.nationality,
          club: ownership.footballPlayer.club,
          age: this.integer(attributes.age),
          heightCm: this.integer(attributes.heightCm ?? attributes.height),
          preferredFoot: this.text(attributes.preferredFoot ?? attributes.foot),
          atRating: this.integer(attributes.atRating ?? attributes.at),
          acquiredAt: ownership.acquiredAt.toISOString(),
          salaryMinor: ownership.salaryMinor,
          rosterStatus: ownership.status,
          currentValueMinor: valuation?.currentValueMinor ?? null,
          lastEffectiveAt: valuation?.effectiveAt.toISOString() ?? null
        };
      })
    };
  }

  async getPlayerValuationHistory(
    userId: string,
    leagueId: string,
    playerId: string
  ): Promise<PlayerValuationHistoryResponse> {
    const participation = await this.prisma.seasonEntry.findFirst({
      where: { ownerUserId: userId, status: 'APPROVED', season: { leagueId } },
      select: { id: true }
    });
    if (!participation) {
      throw this.error('LEAGUE_PARTICIPANT_REQUIRED', '只有联赛参赛用户可以查看身价趋势', 403);
    }
    const player = await this.prisma.footballPlayer.findUnique({ where: { id: playerId } });
    if (!player) throw this.error('FOOTBALL_PLAYER_NOT_FOUND', '球员不存在', 404);
    const history = await this.prisma.playerValuationHistory.findMany({
      where: { leagueId, footballPlayerId: playerId },
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }]
    });
    return {
      leagueId,
      playerId,
      playerName: player.nameZh ?? player.nameEn ?? player.shortName ?? '未命名球员',
      items: history.map((item) => ({
        id: item.id,
        previousValueMinor: item.previousValueMinor,
        valueMinor: item.newValueMinor,
        effectiveAt: item.effectiveAt.toISOString()
      }))
    };
  }

  private attributes(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private integer(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  }

  private text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private error(code: string, message: string, status: number) {
    return new LeagueError(code, message, status);
  }
}
