import { Inject, Injectable } from '@nestjs/common';
import type { GenerateSeasonAllocationRequest } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminAuthorizationService } from '../admin/admin-authorization.service.js';
import { AdminMutationReceiptService } from '../admin/admin-mutation-receipt.service.js';
import { AuditLogService } from '../admin/audit-log.service.js';
import {
  buildFirstSeasonAllocation,
  buildRegularSeasonAllocation,
  type PreviousSeasonStanding
} from './domain/allocation.js';
import { LeagueAllocationError } from './league-allocation.errors.js';

const ALGORITHM_VERSION = 'tiered-v1';
const SEASON_INCLUDE = {
  entries: {
    where: { status: 'APPROVED' as const },
    select: {
      id: true,
      teamNameSnapshot: true,
      previousSeasonEntryId: true,
      status: true
    }
  }
} satisfies Prisma.LeagueSeasonInclude;
const PROPOSAL_INCLUDE = {
  rows: { orderBy: [{ suggestedStageCode: 'asc' as const }, { id: 'asc' as const }] }
} satisfies Prisma.SeasonAllocationProposalInclude;

type ProposalRecord = Prisma.SeasonAllocationProposalGetPayload<{ include: typeof PROPOSAL_INCLUDE }>;

@Injectable()
export class LeagueAllocationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthorizationService) private readonly authorization: AdminAuthorizationService,
    @Inject(AdminMutationReceiptService) private readonly receipts: AdminMutationReceiptService,
    @Inject(AuditLogService) private readonly audit: AuditLogService
  ) {}

  async generate(
    actorAdminId: string,
    leagueId: string,
    seasonId: string,
    input: GenerateSeasonAllocationRequest,
    key: string
  ) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    return this.receipts.execute(
      actorAdminId,
      `admin.league-allocation.generate:${seasonId}`,
      key,
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM league_seasons WHERE id = ${seasonId} FOR UPDATE`;
        const season = await transaction.leagueSeason.findUnique({
          where: { id: seasonId },
          include: SEASON_INCLUDE
        });
        if (!season || season.leagueId !== leagueId) {
          throw new LeagueAllocationError('SEASON_NOT_IN_LEAGUE', '赛季不属于当前联赛', 404);
        }
        if (season.status !== 'ALLOCATION_REVIEW') {
          throw new LeagueAllocationError(
            'SEASON_NOT_IN_ALLOCATION_REVIEW',
            '只有进入分组确认阶段的赛季才能生成分组建议',
            409
          );
        }
        if (season.version !== input.expectedSeasonVersion) {
          throw new LeagueAllocationError('VERSION_CONFLICT', '赛季已被其他管理员修改，请刷新后重试', 409);
        }

        const entries = season.entries.map((entry) => ({
          seasonEntryId: entry.id,
          teamName: entry.teamNameSnapshot
        }));
        const suggestions = season.isFirstSeason
          ? buildFirstSeasonAllocation({
            entries,
            championCapacity: season.championCapacity,
            randomSeed: input.randomSeed
          })
          : buildRegularSeasonAllocation({
            entries,
            previousStandings: await this.previousStandings(transaction, season.previousSeasonId, season.entries),
            superCapacity: season.superCapacity,
            championCapacity: season.championCapacity,
            promotionCount: season.promotionCount,
            randomSeed: input.randomSeed
          });

        const previous = await transaction.seasonAllocationProposal.findFirst({
          where: { seasonId },
          orderBy: { version: 'desc' },
          select: { version: true }
        });
        await transaction.seasonAllocationProposal.updateMany({
          where: { seasonId, status: 'DRAFT' },
          data: { status: 'SUPERSEDED' }
        });
        const proposal = await transaction.seasonAllocationProposal.create({
          data: {
            seasonId,
            version: (previous?.version ?? 0) + 1,
            algorithmVersion: ALGORITHM_VERSION,
            randomSeed: input.randomSeed,
            createdByAdminId: actorAdminId,
            inputSummary: {
              approvedEntryIds: season.entries.map((entry) => entry.id),
              isFirstSeason: season.isFirstSeason,
              superCapacity: season.superCapacity,
              championCapacity: season.championCapacity,
              promotionCount: season.promotionCount
            },
            rows: {
              create: suggestions.map((suggestion) => ({
                seasonEntryId: suggestion.seasonEntryId,
                teamName: suggestion.teamName,
                suggestedStageCode: suggestion.stageCode,
                source: suggestion.source,
                previousRank: suggestion.previousRank,
                pointsPerMatch: suggestion.pointsPerMatch,
                goalDifferencePerMatch: suggestion.goalDifferencePerMatch,
                goalsForPerMatch: suggestion.goalsForPerMatch,
                tiePending: suggestion.tiePending,
                reason: suggestion.reason
              }))
            }
          },
          include: PROPOSAL_INCLUDE
        });
        await this.audit.record(transaction, {
          actorAdminId,
          leagueId,
          action: 'admin.league-allocation.generate',
          resourceType: 'SeasonAllocationProposal',
          resourceId: proposal.id,
          metadata: {
            seasonId,
            proposalVersion: proposal.version,
            randomSeed: proposal.randomSeed,
            approvedEntryCount: season.entries.length
          }
        });
        return this.response(proposal);
      },
      input
    );
  }

  async latest(actorAdminId: string, leagueId: string, seasonId: string) {
    await this.authorization.requireLeagueAccess(actorAdminId, leagueId);
    const season = await this.prisma.leagueSeason.findUnique({
      where: { id: seasonId },
      select: { leagueId: true }
    });
    if (!season || season.leagueId !== leagueId) {
      throw new LeagueAllocationError('SEASON_NOT_IN_LEAGUE', '赛季不属于当前联赛', 404);
    }
    const proposal = await this.prisma.seasonAllocationProposal.findFirst({
      where: { seasonId },
      include: PROPOSAL_INCLUDE,
      orderBy: { version: 'desc' }
    });
    if (!proposal) {
      throw new LeagueAllocationError('ALLOCATION_PROPOSAL_NOT_FOUND', '当前赛季尚未生成分组建议', 404);
    }
    return this.response(proposal);
  }

  private async previousStandings(
    transaction: Prisma.TransactionClient,
    previousSeasonId: string | null,
    entries: Array<{ id: string; teamNameSnapshot: string; previousSeasonEntryId: string | null }>
  ): Promise<PreviousSeasonStanding[]> {
    if (!previousSeasonId) throw this.previousStandingsUnavailable();
    const competition = await transaction.competition.findFirst({
      where: {
        seasonId: previousSeasonId,
        competitionType: 'DIVISION_LEAGUE',
        status: 'COMPLETED'
      },
      include: {
        stages: {
          where: { stageCode: { not: null } },
          include: {
            participants: {
              include: {
                participant: { select: { id: true, seasonEntryId: true } }
              }
            },
            standingsSnapshots: {
              orderBy: { version: 'desc' },
              take: 1,
              include: { rows: true }
            }
          }
        }
      }
    });
    if (!competition || competition.stages.length === 0) throw this.previousStandingsUnavailable();

    const currentByPreviousId = new Map(
      entries
        .filter((entry) => entry.previousSeasonEntryId !== null)
        .map((entry) => [entry.previousSeasonEntryId!, entry])
    );
    const result: PreviousSeasonStanding[] = [];
    for (const stage of competition.stages) {
      const snapshot = stage.standingsSnapshots[0];
      if (!stage.stageCode || !snapshot) throw this.previousStandingsUnavailable();
      const rowByParticipant = new Map(snapshot.rows.map((row) => [row.participantId, row]));
      for (const membership of stage.participants) {
        const previousEntryId = membership.participant.seasonEntryId;
        if (!previousEntryId) continue;
        const currentEntry = currentByPreviousId.get(previousEntryId);
        if (!currentEntry) continue;
        const row = rowByParticipant.get(membership.participant.id);
        if (!row) throw this.previousStandingsUnavailable();
        result.push({
          seasonEntryId: currentEntry.id,
          teamName: currentEntry.teamNameSnapshot,
          stageCode: stage.stageCode,
          rank: row.rank,
          played: row.played,
          totalPoints: row.totalPoints,
          goalDifference: row.goalDifference,
          goalsFor: row.goalsFor
        });
      }
    }
    return result;
  }

  private response(proposal: ProposalRecord) {
    return {
      id: proposal.id,
      seasonId: proposal.seasonId,
      version: proposal.version,
      status: proposal.status,
      algorithmVersion: proposal.algorithmVersion,
      randomSeed: proposal.randomSeed,
      rows: proposal.rows.map((row) => ({
        id: row.id,
        proposalId: row.proposalId,
        seasonEntryId: row.seasonEntryId,
        teamName: row.teamName,
        suggestedStageCode: row.suggestedStageCode,
        source: row.source,
        previousRank: row.previousRank,
        pointsPerMatch: row.pointsPerMatch,
        goalDifferencePerMatch: row.goalDifferencePerMatch,
        goalsForPerMatch: row.goalsForPerMatch,
        tiePending: row.tiePending,
        reason: row.reason
      })),
      createdAt: proposal.createdAt.toISOString()
    };
  }

  private previousStandingsUnavailable() {
    return new LeagueAllocationError(
      'PREVIOUS_STANDINGS_UNAVAILABLE',
      '上一赛季最终积分榜尚不可用，无法生成常规赛季分组建议',
      409
    );
  }
}
