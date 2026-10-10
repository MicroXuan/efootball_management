import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  derivePesdataAutoBuild,
  type FinanceLedgerListResponse,
  type RosterPlayerCandidateQuery,
  type RosterPlayerCandidateListResponse,
  type SalaryRuleVersionListResponse,
  type TeamRosterView,
  type TransferWindowListResponse
} from '@efm/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { LeagueRosterError } from './league-roster.errors.js';
import { LeagueVisibilityService } from '../league-visibility/league-visibility.service.js';

@Injectable()
export class AdminRosterQueriesService {
  private readonly visibility: LeagueVisibilityService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(LeagueVisibilityService) visibility?: LeagueVisibilityService
  ) {
    this.visibility = visibility ?? new LeagueVisibilityService(prisma);
  }

  async salaryRules(leagueId: string): Promise<SalaryRuleVersionListResponse> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
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
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
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
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
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
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const teamLeagueId = await this.visibility.requireVisible({ type: 'TEAM', id: teamId });
    if (teamLeagueId !== leagueId) throw this.visibility.notFound();
    await this.requireSeason(leagueId, seasonId);
    const team = await this.prisma.leagueTeam.findFirst({ where: { id: teamId, leagueId } });
    if (!team) throw new LeagueRosterError('LEAGUE_TEAM_NOT_FOUND', 'League team was not found', 404);
    const entries = await this.prisma.leaguePlayerOwnership.findMany({
      where: { leagueTeamId: teamId, status: { in: ['ACTIVE', 'DISAPPEARED', 'RETIRED'] } },
      include: { footballPlayer: true, currentPlayerCard: { include: { autoBuilds: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } },
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
        rosterCount: entries.filter((entry) => entry.status === 'ACTIVE').length,
        salaryMinor: entries
          .filter((entry) => entry.status === 'ACTIVE')
          .reduce((total, entry) => total + entry.salaryMinor, 0),
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

  async candidates(leagueId: string, query: RosterPlayerCandidateQuery): Promise<RosterPlayerCandidateListResponse> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    const salaryRule = await this.prisma.leagueSalaryRuleVersion.findFirst({
      where: { leagueId, status: 'ACTIVE', effectiveAt: { lte: new Date() } },
      include: { tiers: { orderBy: { minOverall: 'asc' } } },
      orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }]
    });
    const cardFilters = {
      status: 'ACTIVE' as const,
      ...(query.position ? { position: query.position } : {}),
      ...(query.cardType ? { cardType: query.cardType } : {}),
      ...(query.cardPackId ? { cardPackId: query.cardPackId } : {})
    };
    const players = await this.prisma.footballPlayer.findMany({
      where: {
        cards: { some: cardFilters },
        OR: [
          { nameZh: { contains: query.keyword } },
          { nameEn: { contains: query.keyword } },
          { shortName: { contains: query.keyword } },
          { cards: { some: { ...cardFilters, cardName: { contains: query.keyword } } } }
        ]
      },
      include: {
        bestCard: true,
        cards: {
          where: cardFilters,
          include: {
            attributes: true,
            autoBuilds: { orderBy: { calculatedAt: 'desc' }, take: 1 }
          },
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
        recommendedPlayerCardId: player.cards.some((card) => card.id === player.bestCard?.playerCardId)
          ? player.bestCard!.playerCardId
          : player.cards[0]?.id ?? null,
        cards: player.cards.map((card) => {
          const build = card.autoBuilds[0];
          const attributes = objectRecord(card.attributes?.attributesJson);
          const sourceMetadata = objectRecord(attributes?.sourceMetadata);
          const derivedBuild = build ? null : derivePesdataAutoBuild({
            position: card.position,
            overallRating: card.overallRating,
            maxLevel: sourceMetadata?.maxLevel as number | string | null | undefined,
            cardType: card.cardType
          });
          const maxOverall = build?.maxOverall ?? derivedBuild?.maxOverall ?? null;
          return {
            id: card.id,
            cardName: card.cardName,
            imageUrl: card.imageUrl,
            position: card.position,
            overallRating: card.overallRating,
            maxOverall,
            salaryMinor: maxOverall === null
              ? null
              : salaryRule?.tiers.find((tier) =>
                maxOverall >= tier.minOverall && maxOverall <= tier.maxOverall
              )?.salaryMinor ?? null,
            recommended: player.bestCard?.playerCardId === card.id
              || (!player.cards.some((candidate) => candidate.id === player.bestCard?.playerCardId) && player.cards[0]?.id === card.id)
          };
        })
      }))
    };
  }

  async ledger(leagueId: string, teamId?: string): Promise<FinanceLedgerListResponse> {
    await this.visibility.requireVisible({ type: 'LEAGUE', id: leagueId });
    if (teamId) {
      const teamLeagueId = await this.visibility.requireVisible({ type: 'TEAM', id: teamId });
      if (teamLeagueId !== leagueId) throw this.visibility.notFound();
    }
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
        seasonId: entry.seasonId,
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
    const seasonLeagueId = await this.visibility.requireVisible({ type: 'SEASON', id: seasonId });
    if (seasonLeagueId !== leagueId) throw this.visibility.notFound();
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
