import { Inject, Injectable } from '@nestjs/common';
import type {
  FinanceLedgerListResponse,
  RosterPlayerCandidateListResponse,
  SalaryRuleVersionListResponse,
  TeamRosterView,
  TransferWindowListResponse
} from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueRosterError } from './league-roster.errors.js';

@Injectable()
export class AdminRosterQueriesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async salaryRules(leagueId: string): Promise<SalaryRuleVersionListResponse> {
    const rules = await this.prisma.leagueSalaryRuleVersion.findMany({
      where: { leagueId },
      include: { tiers: { orderBy: { minOverall: 'asc' } } },
      orderBy: { version: 'desc' }
    });
    return {
      items: rules.map((rule) => ({
        ...rule,
        effectiveAt: rule.effectiveAt.toISOString(),
        createdAt: rule.createdAt.toISOString()
      }))
    };
  }

  async seasons(leagueId: string) {
    const seasons = await this.prisma.leagueSeason.findMany({
      where: { leagueId },
      include: { _count: { select: { entries: true } }, entries: { where: { status: 'APPROVED' }, select: { id: true } } },
      orderBy: [{ seasonNumber: 'desc' }, { id: 'asc' }]
    });
    return seasons.map((season) => ({
      id: season.id, leagueId: season.leagueId, seasonNumber: season.seasonNumber,
      displayName: season.displayName, previousSeasonId: season.previousSeasonId,
      isFirstSeason: season.isFirstSeason,
      registrationOpensAt: season.registrationOpensAt.toISOString(),
      registrationClosesAt: season.registrationClosesAt.toISOString(),
      startsAt: season.startsAt.toISOString(), endsAt: season.endsAt.toISOString(),
      superCapacity: season.superCapacity, championCapacity: season.championCapacity,
      promotionCount: season.promotionCount, status: season.status,
      entryCount: season._count.entries, approvedEntryCount: season.entries.length,
      version: season.version, createdAt: season.createdAt.toISOString(), updatedAt: season.updatedAt.toISOString()
    }));
  }

  async transferWindows(leagueId: string, seasonId: string): Promise<TransferWindowListResponse> {
    await this.requireSeason(leagueId, seasonId);
    const windows = await this.prisma.transferWindow.findMany({
      where: { seasonId },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }]
    });
    return {
      items: windows.map((window) => ({
        ...window,
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
        createdAt: window.createdAt.toISOString(),
        updatedAt: window.updatedAt.toISOString()
      }))
    };
  }

  async roster(leagueId: string, teamId: string, seasonId: string): Promise<TeamRosterView> {
    await this.requireSeason(leagueId, seasonId);
    const team = await this.prisma.leagueTeam.findFirst({ where: { id: teamId, leagueId } });
    if (!team) throw new LeagueRosterError('LEAGUE_TEAM_NOT_FOUND', 'League team was not found', 404);
    const entries = await this.prisma.leaguePlayerOwnership.findMany({
      where: { leagueTeamId: teamId, status: 'ACTIVE' },
      include: { footballPlayer: true, currentPlayerCard: true },
      orderBy: [{ acquiredAt: 'asc' }, { id: 'asc' }]
    });
    const salaryRule = await this.prisma.leagueSalaryRuleVersion.findFirst({
      where: { leagueId, status: 'ACTIVE', effectiveAt: { lte: new Date() } },
      orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }]
    });
    const activeWindow = await this.prisma.transferWindow.findFirst({
      where: { seasonId, startsAt: { lte: new Date() }, endsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' }
    });
    return {
      teamId,
      teamName: team.name,
      seasonId,
      entries: entries.map((entry) => ({
        id: entry.id,
        leagueId: entry.leagueId,
        leagueTeamId: entry.leagueTeamId,
        playerId: entry.footballPlayerId,
        playerName: entry.footballPlayer.nameZh ?? entry.footballPlayer.nameEn ?? entry.footballPlayer.shortName ?? '未命名球员',
        currentPlayerCardId: entry.currentPlayerCardId,
        cardName: entry.currentPlayerCard.cardName,
        maxOverall: entry.maxOverallSnapshot,
        salaryRuleVersionId: entry.salaryRuleVersionId,
        salaryMinor: entry.salaryMinor,
        acquiredAt: entry.acquiredAt.toISOString(),
        status: entry.status,
        version: entry.version
      })),
      summary: {
        rosterCount: entries.length,
        salaryMinor: entries.reduce((total, entry) => total + entry.salaryMinor, 0),
        salaryCapMinor: salaryRule?.salaryCapMinor ?? 0
      },
      operations: {
        BUY: activeWindow?.allowBuy ?? false,
        SELL: activeWindow?.allowSell ?? false,
        TRANSFER: activeWindow?.allowTransfer ?? false,
        CARD_UPGRADE: activeWindow?.allowCardUpgrade ?? false
      },
      activeWindowName: activeWindow?.name ?? null
    };
  }

  async candidates(leagueId: string, keyword: string): Promise<RosterPlayerCandidateListResponse> {
    const salaryRule = await this.prisma.leagueSalaryRuleVersion.findFirst({
      where: { leagueId, status: 'ACTIVE', effectiveAt: { lte: new Date() } },
      include: { tiers: { orderBy: { minOverall: 'asc' } } },
      orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }]
    });
    const players = await this.prisma.footballPlayer.findMany({
      where: {
        OR: [
          { nameZh: { contains: keyword } },
          { nameEn: { contains: keyword } },
          { shortName: { contains: keyword } }
        ]
      },
      include: {
        bestCard: true,
        cards: {
          where: { status: 'ACTIVE' },
          include: { autoBuilds: { orderBy: { calculatedAt: 'desc' }, take: 1 } },
          orderBy: [{ overallRating: 'desc' }, { id: 'asc' }]
        },
        leagueOwnerships: { where: { leagueId, status: 'ACTIVE' }, take: 1 }
      },
      orderBy: [{ nameZh: 'asc' }, { nameEn: 'asc' }],
      take: 20
    });
    return {
      items: players.map((player) => ({
        playerId: player.id,
        playerName: player.nameZh ?? player.nameEn ?? player.shortName ?? '未命名球员',
        ownedByTeamId: player.leagueOwnerships[0]?.leagueTeamId ?? null,
        recommendedPlayerCardId: player.bestCard?.playerCardId ?? null,
        cards: player.cards.map((card) => {
          const build = card.autoBuilds[0];
          return {
            id: card.id,
            cardName: card.cardName,
            imageUrl: card.imageUrl,
            position: card.position,
            overallRating: card.overallRating,
            maxOverall: build?.maxOverall ?? null,
            salaryMinor: build === undefined
              ? null
              : salaryRule?.tiers.find((tier) =>
                build.maxOverall >= tier.minOverall && build.maxOverall <= tier.maxOverall
              )?.salaryMinor ?? null,
            recommended: player.bestCard?.playerCardId === card.id
          };
        })
      }))
    };
  }

  async ledger(leagueId: string, teamId?: string): Promise<FinanceLedgerListResponse> {
    const entries = await this.prisma.financeLedgerEntry.findMany({
      where: { leagueId, ...(teamId ? { leagueTeamId: teamId } : {}) },
      include: { leagueTeam: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100
    });
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        leagueId: entry.leagueId,
        leagueTeamId: entry.leagueTeamId,
        teamName: entry.leagueTeam.name,
        rosterTransactionId: entry.rosterTransactionId,
        direction: entry.direction,
        type: entry.type,
        amountMinor: entry.amountMinor,
        note: entry.note,
        createdAt: entry.createdAt.toISOString()
      })),
      nextCursor: null
    };
  }

  private async requireSeason(leagueId: string, seasonId: string) {
    const season = await this.prisma.leagueSeason.findFirst({ where: { id: seasonId, leagueId }, select: { id: true } });
    if (!season) throw new LeagueRosterError('LEAGUE_SEASON_NOT_FOUND', 'League season was not found', 404);
  }
}
